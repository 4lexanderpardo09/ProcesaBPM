import { Inject, Injectable } from '@nestjs/common';
import type { TicketDocumentRole } from '@procesabpm/db';
import { InvalidStateError, MAX_FILES_PER_SUBMISSION, MAX_SUBMISSION_BYTES, SubmissionFilesLimitError } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { StoredFileRepository, type StoredFileRow } from '../data/stored-file.repository.js';
import { type NewTicketDocument, TicketDocumentRepository } from '../data/ticket-document.repository.js';

export interface FieldFilesChange {
  readonly fieldCode: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** What a movement attaches to the ticket; the ids were locked by `lockAttachable` earlier in the same transaction. */
export interface AttachmentLink {
  readonly ticketId: string;
  readonly companyId: string;
  readonly stepId: string | null;
  readonly eventId: string;
  readonly at: Date;
  /** Loose attachments (comments, closing documents) and the role they get. */
  readonly attachmentIds: readonly string[];
  readonly attachmentRole: Extract<TicketDocumentRole, 'ATTACHMENT' | 'CLOSING'>;
  readonly fieldFiles: readonly FieldFilesChange[];
}

/**
 * Attaches uploads to tickets. `lockAttachable` runs while the submission is validated and keeps the rows
 * locked until the transaction ends, so two submissions of the same file queue: the second finds it linked.
 */
@Injectable()
export class FileAttachmentService {
  constructor(
    @Inject(StoredFileRepository) private readonly files: StoredFileRepository,
    @Inject(TicketDocumentRepository) private readonly documents: TicketDocumentRepository,
  ) {}

  /**
   * The subset of `ids` this person can attach: their own, confirmed, never attached, of this tenant. Whatever is
   * missing from the result is not attachable and looks the same whether it never existed or belongs to somebody else.
   */
  async lockAttachable(tx: TenantTransaction, tenantId: string, uploaderId: string, ids: readonly string[]): Promise<StoredFileRow[]> {
    const found = await this.files.lockAttachable(tx, tenantId, uploaderId, [...new Set(ids)]);
    this.assertWithinSubmissionLimits(found);
    return found;
  }

  /** The caller's own confirmed, unattached upload, without locking it. */
  peekOwn(tx: TenantTransaction, tenantId: string, uploaderId: string, fileId: string): Promise<StoredFileRow | null> {
    return this.files.findOwnAttachable(tx, tenantId, fileId, uploaderId);
  }

  /** Marks uploads as in use by something that is not a ticket (a PDF template), so the purge job leaves them alone. */
  async linkStandalone(tx: TenantTransaction, tenantId: string, fileIds: readonly string[], companyId: string | null, at: Date): Promise<void> {
    if ((await this.files.markLinked(tx, tenantId, fileIds, companyId, at)) !== fileIds.length) throw new InvalidStateError('A file was attached by someone else in the meantime');
  }

  /** 15 files and 20 MB per submission, counting field files and attachments together. */
  assertWithinSubmissionLimits(files: ReadonlyArray<Pick<StoredFileRow, 'sizeBytes'>>): void {
    const bytes = files.reduce((total, file) => total + file.sizeBytes, 0n);
    if (files.length > MAX_FILES_PER_SUBMISSION || bytes > BigInt(MAX_SUBMISSION_BYTES)) throw new SubmissionFilesLimitError();
  }

  async link(tx: TenantTransaction, tenantId: string, link: AttachmentLink): Promise<void> {
    const newIds = [...link.attachmentIds, ...link.fieldFiles.flatMap((change) => change.added)];
    if (newIds.length > 0 && (await this.files.markLinked(tx, tenantId, newIds, link.companyId, link.at)) !== newIds.length) {
      throw new InvalidStateError('A file was attached by someone else in the meantime');
    }
    const base = { eventId: link.eventId, stepId: link.stepId };
    const documents: NewTicketDocument[] = [
      ...link.attachmentIds.map((fileId): NewTicketDocument => ({ ...base, fileId, role: link.attachmentRole, fieldCode: null })),
      ...link.fieldFiles.flatMap((change) => change.added.map((fileId): NewTicketDocument => ({ ...base, fileId, role: 'ATTACHMENT', fieldCode: change.fieldCode }))),
    ];
    await this.documents.insertMany(tx, tenantId, link.ticketId, documents);
    for (const change of link.fieldFiles) await this.documents.retireFieldFiles(tx, tenantId, link.ticketId, change.fieldCode, change.removed);
  }
}
