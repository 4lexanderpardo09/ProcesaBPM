import { Inject, Injectable } from '@nestjs/common';
import { type DownloadUrlResponse, RateLimitedError } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { DataExportRepository } from '../data/data-export.repository.js';
import { assertMayExport, DATA_EXPORT_POLICY, downloadRefusalFor, downloadUrlTtlSeconds, exportFileName } from '../domain/data-export-policy.js';

/**
 * A short-lived signed link to the archive, issued one at a time: issuing it is the access, so it is counted and audited in
 * one transaction, and the browser fetches the bytes from the storage, never through the API.
 */
@Injectable()
export class DataExportDownloadsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(DataExportRepository) private readonly exports: DataExportRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async issueUrl(principal: Principal, id: string): Promise<DownloadUrlResponse> {
    assertMayExport(principal);
    await this.enforceRate(principal.userId);
    const target = await this.runner.withTenantTransaction(async (tx) => {
      const counted = await this.exports.countDownload(tx, principal.tenantId, id);
      if (counted === undefined) throw downloadRefusalFor(await this.exports.find(tx, principal.tenantId, id));
      await this.audit.record(tx, { action: 'data_export.download_url_issued', subjectType: 'DataExport', subjectId: id, after: { downloadCount: counted.downloadCount } });
      return { ...counted, fileName: exportFileName(await this.exports.findSlug(tx, principal.tenantId), counted.completedAt) };
    });
    const now = this.clock.now();
    const signed = await this.storage.presignDownload({
      key: target.storageKey,
      fileName: target.fileName,
      contentType: 'application/zip',
      disposition: 'attachment',
      expiresInSeconds: downloadUrlTtlSeconds(target.expiresAt, now),
      now,
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  private async enforceRate(userId: string): Promise<void> {
    const result = await this.limiter.hit(`data-export-download:user:${userId}`, DATA_EXPORT_POLICY.downloadUrlsPerUser);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
