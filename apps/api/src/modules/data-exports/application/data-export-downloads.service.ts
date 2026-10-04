import { Inject, Injectable } from '@nestjs/common';
import { type DownloadUrlResponse, type IssueDataExportDownload, RateLimitedError } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter } from '../../../infrastructure/security/rate-limiter.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { CurrentPasswordVerifier } from '../../auth/application/current-password-verifier.js';
import { DataExportRepository } from '../data/data-export.repository.js';
import { assertMayExport, DATA_EXPORT_POLICY, downloadRefusalFor, downloadUrlTtlSeconds, exportFileName } from '../domain/data-export-policy.js';

/**
 * A short-lived signed link to the archive. Any member with full access may take one (not only who asked for the
 * export), always with the current password again, so a stolen access token or refresh cookie alone cannot take the
 * data out. Issuing the link is the access: it is counted and audited, and only once it was actually signed (a signing
 * failure records nothing). The browser fetches the bytes from the storage, never through the API.
 */
@Injectable()
export class DataExportDownloadsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(DataExportRepository) private readonly exports: DataExportRepository,
    @Inject(CurrentPasswordVerifier) private readonly password: CurrentPasswordVerifier,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async issueUrl(principal: Principal, id: string, body: IssueDataExportDownload): Promise<DownloadUrlResponse> {
    assertMayExport(principal);
    await this.enforceRate(principal.userId);
    await this.password.verify(principal.userId, body.currentPassword);
    const target = await this.runner.withTenantTransaction(async (tx) => {
      const found = await this.exports.findDownloadable(tx, principal.tenantId, id);
      if (found === undefined) throw downloadRefusalFor(await this.exports.find(tx, principal.tenantId, id));
      return { ...found, fileName: exportFileName(await this.exports.findSlug(tx, principal.tenantId), found.completedAt) };
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
    // Expired in between: the link is dropped, never returned, and nothing is recorded.
    await this.runner.withTenantTransaction(async (tx) => {
      const downloadCount = await this.exports.countDownload(tx, principal.tenantId, id);
      if (downloadCount === undefined) throw downloadRefusalFor(await this.exports.find(tx, principal.tenantId, id));
      await this.audit.record(tx, { action: 'data_export.download_url_issued', subjectType: 'DataExport', subjectId: id, after: { downloadCount } });
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  private async enforceRate(userId: string): Promise<void> {
    const result = await this.limiter.hit(`data-export-download:user:${userId}`, DATA_EXPORT_POLICY.downloadUrlsPerUser);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
