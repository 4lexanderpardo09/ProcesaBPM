import { Inject, Injectable } from '@nestjs/common';
import {
  allowedTypeOf,
  MAX_PENDING_UPLOADS_PER_USER,
  type RequestUploadsRequest,
  StorageQuotaExceededError,
  SubmissionFilesLimitError,
  type UploadsResponse,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { StoredFileRepository, type StoredFileRow } from '../data/stored-file.repository.js';
import { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { sanitizeFileName } from '../domain/file-name.js';
import { evaluateReservation, quotaLimits } from '../domain/quota-policy.js';

export const UPLOAD_URL_TTL_SECONDS = 600;

/**
 * First phase of an upload: reserve the files (PENDING rows with their immutable storage keys) and the bytes
 * they will take, in one transaction that holds the tenant's usage row, so concurrent requests cannot jointly
 * pass the limit. Signing the upload URLs is local computation and happens after the commit; the browser then
 * sends the bytes straight to the storage.
 */
@Injectable()
export class UploadRequestService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(StoredFileRepository) private readonly files: StoredFileRepository,
    @Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}

  async request(declaration: RequestUploadsRequest): Promise<UploadsResponse> {
    const { tenantId, userId } = this.context.require();
    const at = this.clock.now();
    const reserved = await this.runner.withTenantTransaction(async (tx) => {
      const current = await this.usage.lock(tx, tenantId);
      const requested = declaration.files.reduce((total, file) => total + BigInt(file.sizeBytes), 0n);
      const decision = evaluateReservation(quotaLimits(await this.usage.termsOf(tx, tenantId)), current, requested);
      if (!decision.allowed) throw new StorageQuotaExceededError();
      if ((await this.files.countPending(tx, tenantId, userId)) + declaration.files.length > MAX_PENDING_UPLOADS_PER_USER) throw new SubmissionFilesLimitError();

      const rows: StoredFileRow[] = [];
      for (const file of declaration.files) {
        const type = allowedTypeOf(file.name)!;
        rows.push(await this.files.insertPending(tx, tenantId, userId, { name: sanitizeFileName(file.name), mimeType: type.mime, sizeBytes: file.sizeBytes, sha256: file.sha256 }, at));
      }
      await this.usage.adjust(tx, tenantId, { reservedBytes: requested });
      return { rows, overLimit: decision.overLimit };
    });

    const uploads = await Promise.all(
      reserved.rows.map(async (row) => {
        const signed = await this.storage.presignUpload({ key: row.storageKey, contentType: row.mimeType, contentLength: Number(row.sizeBytes), expiresInSeconds: UPLOAD_URL_TTL_SECONDS, now: at });
        return { fileId: row.id, url: signed.url, method: signed.method, headers: signed.headers, expiresAt: signed.expiresAt.toISOString() };
      }),
    );
    return { uploads, quota: { overLimit: reserved.overLimit } };
  }
}
