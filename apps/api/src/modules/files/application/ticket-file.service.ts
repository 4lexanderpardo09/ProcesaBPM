import { Inject, Injectable } from '@nestjs/common';
import { DocumentsTooLargeError, type DownloadUrlResponse, NotFoundError, type TicketDocumentResponse, type TicketStepFileResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import type { StoredFileRow } from '../data/stored-file.repository.js';
import { TicketDocumentRepository } from '../data/ticket-document.repository.js';
import { dispositionOf } from '../domain/ticket-file-disposition.js';
import { kindOf, toStoredFileResponse } from './file-responses.js';

export const DOWNLOAD_URL_TTL_SECONDS = 120;

/** What one combined PDF may gather: more than this is downloaded file by file. */
export const COMBINED_MAX_BYTES = 40 * 1024 * 1024;

const COMBINABLE_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/** The workflow's documents first (main, then each step's, then closing), then the files people added, oldest first. */
const ROLE_ORDER: Readonly<Record<string, number>> = { MAIN_DOCUMENT: 0, STEP_DOCUMENT: 1, CLOSING: 2, SIGNATURE: 3 };

export interface CombinableFile {
  readonly name: string;
  readonly mimeType: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
}

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

  async stepFiles(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketStepFileResponse[]> {
    const rows = await this.documents.currentStepFiles(tx, tenantId, ticketId);
    return rows.map((row) => ({ label: row.label, file: toStoredFileResponse(row.file) }));
  }

  /** The current files of the ticket that can go into one PDF (PDFs and PNG or JPEG images), in reading order. */
  async combinable(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<CombinableFile[]> {
    const rows = (await this.documents.list(tx, tenantId, ticketId)).filter((row) => row.isCurrent && row.file.status === 'CONFIRMED' && COMBINABLE_TYPES.has(row.file.mimeType));
    const ordered = [...rows].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime());
    const files = ordered.map((row) => ({ name: row.file.originalName, mimeType: row.file.mimeType, storageKey: row.file.storageKey, sizeBytes: Number(row.file.sizeBytes) }));
    if (files.reduce((total, file) => total + file.sizeBytes, 0) > COMBINED_MAX_BYTES) throw new DocumentsTooLargeError(COMBINED_MAX_BYTES);
    return files;
  }

  /** The bytes of each file, read from the storage (after the transaction: it can take a while). */
  read(files: readonly CombinableFile[]): Promise<Uint8Array[]> {
    return Promise.all(files.map((file) => this.storage.read(file.storageKey, file.sizeBytes + 1)));
  }

  /** The file, if it really is a document of this ticket or a support file of its current step. Signing happens after the transaction (`signDownload`). */
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
