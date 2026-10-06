import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { allowedTypeOf, FileNotUploadedError, FileRejectedError, type FileRejectionReason, judgeContent, MAX_FILE_BYTES, NotFoundError, type StoredFileResponse } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { StoredFileRepository, type StoredFileRow } from '../data/stored-file.repository.js';
import { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { toStoredFileResponse } from './file-responses.js';

type Verdict = { readonly ok: true; readonly mimeType: string } | { readonly ok: false; readonly reason: FileRejectionReason };

/**
 * Second phase of an upload: check what the browser really sent. The storage is asked (outside any database
 * transaction) for the size and the content; only then does a short transaction move the file to CONFIRMED and
 * the reserved bytes to used. The storage never overwrites an object, so what was verified is what stays.
 * Confirming twice is harmless: the second call finds the file already CONFIRMED.
 */
@Injectable()
export class UploadConfirmationService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(StoredFileRepository) private readonly files: StoredFileRepository,
    @Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async confirm(fileId: string): Promise<StoredFileResponse> {
    const { tenantId, userId } = this.context.require();
    const pending = await this.runner.withTenantTransaction((tx) => this.files.findOwn(tx, tenantId, fileId, userId));
    if (pending === null || pending.status === 'DELETED') throw new NotFoundError();
    if (pending.status === 'CONFIRMED') return toStoredFileResponse(pending);

    const verdict = await this.inspect(pending);
    if (!verdict.ok) {
      // The presigned upload URL stays valid for minutes after this, so the client could write the object again.
      // Deleting the row here would leave an untracked object (the purge walks the rows) and free the reserved
      // bytes while they can still be written: a way to fill storage outside the quota (S3). The PENDING row and
      // its reservation stay; the abandoned-upload purge removes the row, the object and the reservation together
      // once the URL can no longer be used.
      this.logger.warn(`Rejected upload ${pending.id} (${verdict.reason}); its reservation stays until the purge`, 'UploadConfirmationService');
      throw new FileRejectedError(verdict.reason);
    }
    const row = await this.runner.withTenantTransaction((tx) => this.accept(tx, tenantId, pending.id, verdict.mimeType));
    return toStoredFileResponse(row);
  }

  /** Reads the storage; throws `FileNotUploadedError` (the client may retry) when the object is not there yet. */
  private async inspect(file: StoredFileRow): Promise<Verdict> {
    const head = await this.storage.head(file.storageKey);
    if (head === null) throw new FileNotUploadedError();
    if (BigInt(head.sizeBytes) !== file.sizeBytes) return { ok: false, reason: 'SIZE_MISMATCH' };
    const content = await this.storage.read(file.storageKey, MAX_FILE_BYTES);
    if (createHash('sha256').update(content).digest('hex') !== file.sha256) return { ok: false, reason: 'HASH_MISMATCH' };
    const verdict = judgeContent(content, allowedTypeOf(file.originalName)!);
    return verdict.ok ? { ok: true, mimeType: verdict.mime } : { ok: false, reason: verdict.reason };
  }

  /** Lock order is always the file row, then the usage row. */
  private async accept(tx: TenantTransaction, tenantId: string, id: string, mimeType: string): Promise<StoredFileRow> {
    const locked = await this.files.lock(tx, tenantId, id);
    if (locked === null) throw new NotFoundError();
    if (locked.status === 'CONFIRMED') return locked;

    await this.usage.lock(tx, tenantId);
    const at = this.clock.now();
    await this.files.confirm(tx, tenantId, id, mimeType, at);
    await this.usage.adjust(tx, tenantId, { reservedBytes: -locked.sizeBytes, usedBytes: locked.sizeBytes });
    return { ...locked, status: 'CONFIRMED', mimeType, confirmedAt: at };
  }

}
