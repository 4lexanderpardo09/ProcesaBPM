import { Inject, Injectable } from '@nestjs/common';
import { type DownloadUrlResponse, NotFoundError, type TicketDocumentResponse, type TicketStepFileResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { combinePdf } from '../../../infrastructure/pdf/pdf-combiner.js';
import { TicketFileService } from '../../files/application/ticket-file.service.js';
import { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { readableTickets } from './ticket-access.js';

/**
 * The files of a ticket, for whoever may read the ticket (decided by the database, per record). A ticket the
 * caller cannot read answers exactly like one that does not exist, and so does a file that is not the ticket's. The support
 * files of the step the ticket is on count as the ticket's while it is there.
 */
@Injectable()
export class TicketDocumentsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
    @Inject(TicketFileService) private readonly files: TicketFileService,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(ability: AppAbility, ticketId: string): Promise<TicketDocumentResponse[]> {
    return this.readable(ability, ticketId, (tx, tenantId) => this.files.list(tx, tenantId, ticketId));
  }

  stepFiles(ability: AppAbility, ticketId: string): Promise<TicketStepFileResponse[]> {
    return this.readable(ability, ticketId, (tx, tenantId) => this.files.stepFiles(tx, tenantId, ticketId));
  }

  downloadUrl(ability: AppAbility, ticketId: string, fileId: string): Promise<DownloadUrlResponse> {
    // The access is recorded in the transaction that decided it, before any URL exists: a refused request leaves no row.
    return this.readable(ability, ticketId, async (tx, tenantId) => {
      const file = await this.files.locate(tx, tenantId, ticketId, fileId);
      await this.audit.record(tx, { action: 'file.download_url_issued', subjectType: 'StoredFile', subjectId: fileId, after: { ticketId, fileName: file.originalName } });
      return file;
    }).then((file) => this.files.signDownload(file));
  }

  /**
   * Every PDF and image of the ticket in one PDF, to print or send at once: the workflow's documents first, then the
   * attachments. Other kinds of files (spreadsheets, archives) are not part of it; a file that cannot be read is left out.
   */
  async combined(ability: AppAbility, ticketId: string): Promise<{ bytes: Uint8Array; fileName: string; skipped: string[] }> {
    const { files, number } = await this.readable(ability, ticketId, async (tx, tenantId) => {
      const found = await this.files.combinable(tx, tenantId, ticketId);
      const ticketNumber = await this.tickets.numberOf(tx, tenantId, ticketId);
      await this.audit.record(tx, { action: 'ticket.documents_combined', subjectType: 'Ticket', subjectId: ticketId, after: { files: found.length } });
      return { files: found, number: ticketNumber };
    });
    const contents = await this.files.read(files);
    const { bytes, skipped } = await combinePdf(files.map((file, index) => ({ name: file.name, mimeType: file.mimeType, bytes: contents[index]! })), `Ticket ${number}`);
    return { bytes, fileName: `ticket-${number}-documentos.pdf`, skipped };
  }

  private readable<T>(ability: AppAbility, ticketId: string, work: (tx: TenantTransaction, tenantId: string) => Promise<T>): Promise<T> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      if (!(await this.tickets.isAccessible(tx, tenantId, ticketId, readableTickets(ability)))) throw new NotFoundError();
      return work(tx, tenantId);
    });
  }
}
