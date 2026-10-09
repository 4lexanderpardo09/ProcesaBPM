import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { StoredFileRepository } from '../data/stored-file.repository.js';
import { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { QuotaWarningService } from './quota-warning.service.js';

export const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;
export const PURGE_TENANT_BATCH = 100;
export const PURGE_FILE_BATCH = 500;

/**
 * Removes abandoned uploads: files that were reserved or confirmed but never attached to anything, older than a
 * day (upload URLs last ten minutes, so nobody can still be sending them). It is the only physical deletion of
 * user files. The database names the tenants (`find_tenants_with_stale_uploads`); each one is then cleaned inside
 * its own context, where the rows and the quota counter change in one transaction. Objects are deleted after the
 * commit: a failure leaves an orphan object (no row, no quota effect), never a row without its object.
 */
@Injectable()
export class FilePurgeJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(StoredFileRepository) private readonly files: StoredFileRepository,
    @Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository,
    @Inject(QuotaWarningService) private readonly warnings: QuotaWarningService,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async runOnce(): Promise<{ tenants: number; files: number; failed: number }> {
    const cutoff = new Date(this.clock.now().getTime() - STALE_UPLOAD_AGE_MS);
    const tenantIds = await this.runner.withoutTenant((tx) => this.files.findTenantsWithStale(tx, cutoff, PURGE_TENANT_BATCH));
    let files = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      try {
        files += await this.purgeTenant(tenantId, cutoff);
      } catch (error) {
        failed += 1;
        this.logger.error(error, 'FilePurgeJob');
      }
    }
    return { tenants: tenantIds.length, files, failed };
  }

  private async purgeTenant(tenantId: string, cutoff: Date): Promise<number> {
    const stale = await this.runner.withTenant(tenantId, async (tx) => {
      const batch = await this.files.lockStale(tx, tenantId, cutoff, PURGE_FILE_BATCH);
      if (batch.length === 0) return batch;
      const sum = (status: string) => batch.filter((file) => file.status === status).reduce((total, file) => total + file.sizeBytes, 0n);
      await this.files.removeMany(tx, tenantId, batch.map((file) => file.id));
      const current = await this.usage.lock(tx, tenantId);
      const pending = sum('PENDING');
      const confirmed = sum('CONFIRMED');
      if (current.reservedBytes < pending || current.usedBytes < confirmed) this.logger.warn(`Usage counter of tenant ${tenantId} was lower than the purged files`, 'FilePurgeJob');
      const freed = confirmed > current.usedBytes ? current.usedBytes : confirmed;
      await this.usage.adjust(tx, tenantId, {
        reservedBytes: -(pending > current.reservedBytes ? current.reservedBytes : pending),
        usedBytes: -freed,
      });
      await this.warnings.sync(tx, tenantId, current, current.usedBytes - freed);
      return batch;
    });
    const { failed } = await this.storage.deleteMany(stale.map((file) => file.storageKey));
    if (failed.length > 0) this.logger.warn(`Could not delete ${failed.length} objects of tenant ${tenantId}`, 'FilePurgeJob');
    return stale.length;
  }
}
