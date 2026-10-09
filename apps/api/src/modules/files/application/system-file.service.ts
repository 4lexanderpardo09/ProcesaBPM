import { Inject, Injectable } from '@nestjs/common';
import type { TicketDocumentRole } from '@procesabpm/db';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { StoredFileRepository } from '../data/stored-file.repository.js';
import { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { TicketDocumentRepository } from '../data/ticket-document.repository.js';
import { quotaLimits, storageState } from '../domain/quota-policy.js';
import { QuotaWarningService } from './quota-warning.service.js';

export interface GeneratedDocument {
  readonly fileId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly ticketId: string;
  readonly role: Extract<TicketDocumentRole, 'MAIN_DOCUMENT' | 'STEP_DOCUMENT'>;
  readonly stepId: string | null;
  readonly eventId: string;
  readonly at: Date;
}

/**
 * Files the system itself produces (generated PDFs). They are stored and counted for the quota like any other, but
 * they are never refused for it: a document the process needs cannot fail because the plan is full. Going over the
 * limit only blocks the next user upload.
 */
@Injectable()
export class SystemFileService {
  constructor(
    @Inject(StoredFileRepository) private readonly files: StoredFileRepository,
    @Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository,
    @Inject(TicketDocumentRepository) private readonly documents: TicketDocumentRepository,
    @Inject(QuotaWarningService) private readonly warnings: QuotaWarningService,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * Registers a stored PDF as the new current version of the ticket's document. Idempotent by file id: the same
   * generation recorded twice leaves one file, one document row and one count. Versions of a ticket serialize on an
   * advisory lock, so two generations never choose the same number.
   */
  async recordGeneratedDocument(tx: TenantTransaction, tenantId: string, document: GeneratedDocument): Promise<'recorded' | 'already_recorded'> {
    await this.documents.lockVersions(tx, tenantId, document.ticketId);
    if (await this.documents.existsForFile(tx, tenantId, document.fileId)) return 'already_recorded';

    const ticketCompanyId = await this.files.companyOfTicket(tx, tenantId, document.ticketId);
    await this.files.insertSystemFile(tx, tenantId, { ...document, companyId: ticketCompanyId });
    const before = await this.usage.lock(tx, tenantId);
    await this.usage.adjust(tx, tenantId, { usedBytes: BigInt(document.sizeBytes) });
    await this.documents.publishNewVersion(tx, tenantId, document);
    await this.warnIfOverQuota(tx, tenantId, before.usedBytes + before.reservedBytes + BigInt(document.sizeBytes));
    await this.warnings.sync(tx, tenantId, before, before.usedBytes + BigInt(document.sizeBytes));
    return 'recorded';
  }

  private async warnIfOverQuota(tx: TenantTransaction, tenantId: string, committedBytes: bigint): Promise<void> {
    const limits = quotaLimits(await this.usage.termsOf(tx, tenantId));
    const state = storageState(limits, { usedBytes: committedBytes, reservedBytes: 0n });
    if (state !== 'OK') this.logger.warn({ message: 'quota_exceeded_by_system_file', tenantId, state, overByBytes: (committedBytes - limits.limitBytes).toString() }, 'SystemFileService');
  }
}
