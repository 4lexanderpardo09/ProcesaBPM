import { Inject, Injectable } from '@nestjs/common';
import { type DownloadUrlResponse, NotFoundError, type TicketDocumentResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { TicketFileService } from '../../files/application/ticket-file.service.js';
import { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { readableTickets } from './ticket-access.js';

/**
 * The files of a ticket, for whoever may read the ticket (decided by the database, per record). A ticket the
 * caller cannot read answers exactly like one that does not exist, and so does a file that is not the ticket's.
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

  downloadUrl(ability: AppAbility, ticketId: string, fileId: string): Promise<DownloadUrlResponse> {
    // The access is recorded in the transaction that decided it, before any URL exists: a refused request leaves no row.
    return this.readable(ability, ticketId, async (tx, tenantId) => {
      const file = await this.files.locate(tx, tenantId, ticketId, fileId);
      await this.audit.record(tx, { action: 'file.download_url_issued', subjectType: 'StoredFile', subjectId: fileId, after: { ticketId, fileName: file.originalName } });
      return file;
    }).then((file) => this.files.signDownload(file));
  }

  private readable<T>(ability: AppAbility, ticketId: string, work: (tx: TenantTransaction, tenantId: string) => Promise<T>): Promise<T> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      if (!(await this.tickets.isAccessible(tx, tenantId, ticketId, readableTickets(ability)))) throw new NotFoundError();
      return work(tx, tenantId);
    });
  }
}
