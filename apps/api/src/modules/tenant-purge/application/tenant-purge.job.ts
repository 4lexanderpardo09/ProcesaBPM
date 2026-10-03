import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { type PurgeClaim, TenantPurgeRepository } from '../data/tenant-purge.repository.js';

export const PURGE_TENANTS_PER_RUN = 3;
export const PURGE_LEASE_MINUTES = 30;
/** Objects per round trip (the S3 limit of one list and of one batch delete). */
export const PURGE_STORAGE_BATCH = 1000;
/** A tenant with millions of objects is emptied over several runs: the claim is released before it expires. */
export const PURGE_STORAGE_BUDGET_MS = 20 * 60_000;
/** The last step deletes in one transaction; the function sets its own statement limit of 30 minutes. */
export const PURGE_DATABASE_TIMEOUT_MS = 31 * 60_000;
const MIN_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const RESUME_SOON_MS = 60_000;

class StorageBudgetExceeded extends Error {}

/**
 * Purges the tenants whose 30 days are over, one claim at a time. Each tenant goes through idempotent steps in a fixed
 * order: (a) delete every object under `tenants/<id>/` in batches until none is left, (b) delete the data and leave the
 * tombstone in one transaction (`finish_tenant_purge`). The tombstone is the "done" marker: until it exists the tenant
 * is claimed again, and a step that already happened simply finds nothing to do. A failure releases the claim with a
 * retry time (exponential, at most 6 hours). External effects (storage) never run inside a database transaction.
 */
@Injectable()
export class TenantPurgeJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(TenantPurgeRepository) private readonly purges: TenantPurgeRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async runOnce(): Promise<{ claimed: number; purged: number; failed: number }> {
    const claims = await this.runner.withoutTenant((tx) => this.purges.claimDue(tx, PURGE_TENANTS_PER_RUN, PURGE_LEASE_MINUTES));
    let purged = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        await this.emptyStorage(claim.tenantId);
        if (await this.runner.withoutTenant((tx) => this.purges.finish(tx, claim), { timeoutMs: PURGE_DATABASE_TIMEOUT_MS })) {
          purged += 1;
          await this.sweepLateObjects(claim.tenantId);
        }
      } catch (error) {
        failed += 1;
        await this.release(claim, error);
      }
    }
    return { claimed: claims.length, purged, failed };
  }

  private async emptyStorage(tenantId: string): Promise<void> {
    const prefix = `tenants/${tenantId}/`;
    const deadline = this.clock.now().getTime() + PURGE_STORAGE_BUDGET_MS;
    for (;;) {
      const keys = await this.storage.listKeys(prefix, PURGE_STORAGE_BATCH);
      if (keys.length === 0) return;
      const { failed } = await this.storage.deleteMany(keys);
      if (failed.length > 0) throw new Error(`Could not delete ${failed.length} objects of the tenant's storage area`);
      if (this.clock.now().getTime() > deadline) throw new StorageBudgetExceeded('The storage area is large: the purge continues in the next run');
    }
  }

  /**
   * After the tombstone exists, once more: an object written by work that was already in flight when the tenant was
   * locked (a generated document) could have landed between step (a) and the end of step (b). Nothing writes for a
   * pending tenant any more, so one sweep is enough. Best effort: the tenant is purged either way.
   */
  private async sweepLateObjects(tenantId: string): Promise<void> {
    try {
      await this.emptyStorage(tenantId);
    } catch (error) {
      this.logger.error(error, 'TenantPurgeJob');
    }
  }

  private async release(claim: PurgeClaim, error: unknown): Promise<void> {
    const resumeSoon = error instanceof StorageBudgetExceeded;
    const delay = resumeSoon ? RESUME_SOON_MS : Math.min(MIN_BACKOFF_MS * 2 ** (claim.attempt - 1), MAX_BACKOFF_MS);
    const message = error instanceof Error ? error.message : String(error);
    if (!resumeSoon) this.logger.error(error, 'TenantPurgeJob');
    try {
      await this.runner.withoutTenant((tx) => this.purges.fail(tx, claim, message, new Date(this.clock.now().getTime() + delay)));
    } catch (releaseError) {
      // The claim then simply expires (30 minutes) and the tenant is tried again.
      this.logger.error(releaseError, 'TenantPurgeJob');
    }
  }
}
