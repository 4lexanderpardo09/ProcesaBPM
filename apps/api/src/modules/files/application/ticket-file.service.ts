import { Inject, Injectable } from '@nestjs/common';
import { type DownloadUrlResponse, NotFoundError, type TicketDocumentResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import type { StoredFileRow } from '../data/stored-file.repository.js';
import { TicketDocumentRepository } from '../data/ticket-document.repository.js';
import { dispositionOf } from '../domain/ticket-file-disposition.js';
import { kindOf, toStoredFileResponse } from './file-responses.js';

export const DOWNLOAD_URL_TTL_SECONDS = 120;

/**
 * The files of a ticket. Whether the caller may read the ticket is decided by the tickets module before these
 * methods run (they take the transaction that check ran in); here the file must really belong to that ticket.
 */
@Injectable()
export class TicketFileService {
  constructor(
    @Inject(TicketDocumentRepository) private readonly documents: TicketDocumentRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async list(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketDocumentResponse[]> {
    const rows = await this.documents.list(tx, tenantId, ticketId);
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      eventId: row.eventId,
      stepId: row.stepId,
      fieldCode: row.fieldCode,
      version: row.version,
      isCurrent: row.isCurrent,
      createdAt: row.createdAt.toISOString(),
      file: toStoredFileResponse(row.file),
    }));
  }

  /** The file, if it really is a document of this ticket. Signing happens after the transaction (`signDownload`). */
  async locate(tx: TenantTransaction, tenantId: string, ticketId: string, fileId: string): Promise<StoredFileRow> {
    const file = await this.documents.findFile(tx, tenantId, ticketId, fileId);
    if (file === null) throw new NotFoundError();
    return file;
  }

  /** A short-lived signed URL; the browser fetches the bytes from the storage, never through the API. */
  async signDownload(file: StoredFileRow): Promise<DownloadUrlResponse> {
    const signed = await this.storage.presignDownload({
      key: file.storageKey,
      fileName: file.originalName,
      contentType: file.mimeType,
      disposition: dispositionOf(kindOf(file)),
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      now: this.clock.now(),
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
