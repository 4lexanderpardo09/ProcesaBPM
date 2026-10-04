import { createHash, type Hash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { extractSqlState } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import { ZipArchiveFactory, type ZipSink } from '../../../infrastructure/archive/zip-archive.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { type MultipartWrite, ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { type DataExportClaim, DataExportClaimsRepository } from '../data/data-export-claims.repository.js';
import { exportFailureOf, type ExportRetry } from '../domain/export-errors.js';
import { exportCounts } from '../domain/export-manifest.js';
import { exportObjectKey } from '../domain/export-object-key.js';
import { ExportArchiveBuilder } from './export-archive-builder.js';
import { ExportBudget } from './export-budget.js';
import { EXPORT_LEASE_MINUTES, ExportLease } from './export-lease.js';

/** One export at a time per worker process: an archive is long work and the others wait in the queue. */
export const EXPORTS_PER_RUN = 1;
const RETRY_DELAY_MS: Readonly<Record<Exclude<ExportRetry, 'never'>, number>> = { soon: 60_000, later: 5 * 60_000 };
const NOT_STOPPED: AbortSignal = new AbortController().signal;

export type ExportOutcome = 'ready' | 'failed' | 'discarded';

/** Counts and hashes the archive's bytes on their way to the storage, and refuses them once a limit is reached. */
class ExportSink implements ZipSink {
  private readonly hash: Hash = createHash('sha256');

  constructor(
    private readonly upload: MultipartWrite,
    private readonly budget: ExportBudget,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    this.budget.addBytes(chunk.length);
    this.hash.update(chunk);
    await this.upload.write(chunk);
  }

  sha256(): string {
    return this.hash.digest('hex');
  }
}

/**
 * Builds the organization data exports that are due (docs/arquitectura.md §20): claims one, keeps its lease alive,
 * streams the zip into a multipart upload at `tenants/<tenant>/exports/<export>.zip`, and finishes it (READY, the
 * e-mail queued by the database) or records a failure code. Rules: nothing is written once the lease is refused; the
 * lease is renewed right before the object becomes visible; the partial upload is always aborted; an object written
 * for a claim that is no longer ours (finish refused) is deleted. Logs carry ids, codes and counts, never data.
 */
@Injectable()
export class DataExportJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(DataExportClaimsRepository) private readonly claims: DataExportClaimsRepository,
    @Inject(ExportArchiveBuilder) private readonly builder: ExportArchiveBuilder,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(ZipArchiveFactory) private readonly zips: ZipArchiveFactory,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {}

  async runOnce(stop: AbortSignal = NOT_STOPPED): Promise<{ claimed: number; ready: number; failed: number }> {
    if (stop.aborted) return { claimed: 0, ready: 0, failed: 0 };
    const claims = await this.runner.withoutTenant((tx) => this.claims.claimDue(tx, EXPORTS_PER_RUN, EXPORT_LEASE_MINUTES));
    let ready = 0;
    let failed = 0;
    for (const claim of claims) {
      const outcome = await this.run(claim, stop);
      if (outcome === 'ready') ready += 1;
      if (outcome === 'failed') failed += 1;
    }
    return { claimed: claims.length, ready, failed };
  }

  async run(claim: DataExportClaim, stop: AbortSignal = NOT_STOPPED): Promise<ExportOutcome> {
    const key = exportObjectKey(claim.tenantId, claim.exportId);
    const lease = new ExportLease(
      () => this.runner.withoutTenant((tx) => this.claims.renew(tx, claim, EXPORT_LEASE_MINUTES)),
      this.clock,
      (error) => this.warn('data_export.renew_failed', claim, error),
    );
    const budget = new ExportBudget(this.clock, this.clock.now().getTime() + this.settings.DATA_EXPORT_MAX_RUN_MS, this.settings.DATA_EXPORT_MAX_BYTES, AbortSignal.any([lease.signal, stop]));
    let upload: MultipartWrite | undefined;
    lease.start();
    try {
      // A previous attempt may have left its object (it never became READY): this attempt writes it again.
      await this.storage.delete(key);
      upload = await this.storage.openMultipartWrite(key, 'application/zip');
      const sink = new ExportSink(upload, budget);
      const manifest = await this.builder.build(this.zips.open(sink, { mtime: this.clock.now() }), claim, budget);
      await lease.confirm();
      const { sizeBytes } = await upload.complete();
      upload = undefined;
      lease.stop();
      return await this.finish(claim, key, { sizeBytes, sha256: sink.sha256(), counts: exportCounts(manifest) });
    } catch (error) {
      await this.recordFailure(claim, error);
      return 'failed';
    } finally {
      lease.stop();
      await upload?.abort().catch((error: unknown) => this.warn('data_export.abort_failed', claim, error));
    }
  }

  private async finish(claim: DataExportClaim, key: string, result: { sizeBytes: number; sha256: string; counts: Record<string, number> }): Promise<ExportOutcome> {
    if (await this.runner.withoutTenant((tx) => this.claims.finish(tx, claim, result))) {
      this.logger.info('data_export.ready', { event: 'data_export.ready', tenantId: claim.tenantId, exportId: claim.exportId, attempt: claim.attempt, sizeBytes: result.sizeBytes });
      return 'ready';
    }
    // Not ours any more (another worker, or the purge is due): the object must not outlive the claim.
    await this.storage.delete(key).catch((error: unknown) => this.warn('data_export.discard_failed', claim, error));
    this.logger.info('data_export.discarded', { event: 'data_export.discarded', tenantId: claim.tenantId, exportId: claim.exportId, attempt: claim.attempt });
    return 'discarded';
  }

  private async recordFailure(claim: DataExportClaim, error: unknown): Promise<void> {
    const failure = exportFailureOf(error);
    this.warn('data_export.failed', claim, error, { code: failure.code });
    const retryAt = failure.retry === 'never' ? null : new Date(this.clock.now().getTime() + RETRY_DELAY_MS[failure.retry]);
    try {
      await this.runner.withoutTenant((tx) => this.claims.fail(tx, claim, failure.code, retryAt));
    } catch (recordError) {
      // The lease then expires and the claim is tried again (or ends LEASE_EXPIRED after the last attempt).
      this.warn('data_export.fail_not_recorded', claim, recordError);
    }
  }

  private warn(event: string, claim: DataExportClaim, error: unknown, extra: Record<string, unknown> = {}): void {
    this.logger.warn(event, {
      event,
      tenantId: claim.tenantId,
      exportId: claim.exportId,
      attempt: claim.attempt,
      errorName: error instanceof Error ? error.name : typeof error,
      sqlState: extractSqlState(error) ?? null,
      ...extra,
    });
  }
}
