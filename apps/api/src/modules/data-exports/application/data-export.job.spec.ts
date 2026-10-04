import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { WorkerSettings } from '../../../config/worker-settings.js';
import { YazlZipArchiveFactory, type ZipArchive } from '../../../infrastructure/archive/zip-archive.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { InMemoryObjectStorage } from '../../../infrastructure/storage/in-memory-object-storage.js';
import { readZip } from '../../../../test/support/zip-reader.js';
import type { DataExportClaim, DataExportClaimsRepository, FinishedExport } from '../data/data-export-claims.repository.js';
import { ExportStoppedError } from '../domain/export-errors.js';
import { buildManifest, type ExportManifest } from '../domain/export-manifest.js';
import type { ExportArchiveBuilder } from './export-archive-builder.js';
import type { ExportBudget } from './export-budget.js';
import { DataExportJob } from './data-export.job.js';
import { EXPORT_HEARTBEAT_MS } from './export-lease.js';

const CLAIM: DataExportClaim = { tenantId: '0199a8f0-0000-7000-8000-00000000000a', exportId: '0199a8f0-0000-7000-8000-00000000000e', includeFiles: true, claimToken: 'token', attempt: 1 };
const KEY = `tenants/${CLAIM.tenantId}/exports/${CLAIM.exportId}.zip`;
const START = Date.parse('2026-10-04T10:00:00Z');

const manifest: ExportManifest = buildManifest({ exportId: CLAIM.exportId, tenant: { id: CLAIM.tenantId, name: 'Acme', slug: 'acme' }, generatedAt: new Date(START), includeFiles: true, datasets: { tickets: 2 }, csv: { tickets: 2 }, files: 0, missingFiles: [] });

class FakeClaims {
  renewals: Array<boolean | Error> = [];
  finishError: Error | undefined;
  finishResult = true;
  readonly finished: FinishedExport[] = [];
  readonly failures: Array<{ code: string; retryAt: Date | null }> = [];
  claimDue = vi.fn(async () => [CLAIM]);
  async renew(): Promise<boolean> {
    const answer = this.renewals.shift() ?? true;
    if (answer instanceof Error) throw answer;
    return answer;
  }
  async finish(_tx: unknown, _claim: DataExportClaim, result: FinishedExport): Promise<boolean> {
    if (this.finishError !== undefined) throw this.finishError;
    this.finished.push(result);
    return this.finishResult;
  }
  async fail(_tx: unknown, _claim: DataExportClaim, code: string, retryAt: Date | null): Promise<boolean> {
    this.failures.push({ code, retryAt });
    return true;
  }
}

/** Writes `chunks` entries of random (incompressible) bytes, running `between` before each one. */
function fakeBuilder(chunks: number, between: (index: number) => void = () => undefined, chunkBytes = 1_000) {
  return {
    async build(zip: ZipArchive, _claim: DataExportClaim, budget: ExportBudget): Promise<ExportManifest> {
      try {
        for (let index = 0; index < chunks; index += 1) {
          between(index);
          budget.check();
          await zip.addBytes(`data/part-${index}.txt`, randomBytes(chunkBytes));
        }
        await zip.finish();
        return manifest;
      } catch (error) {
        zip.destroy(error as Error);
        throw error;
      }
    },
  };
}

function setup(builder: ReturnType<typeof fakeBuilder>, settings: Partial<WorkerSettings> = {}) {
  let now = START;
  const clock = { now: () => new Date(now) };
  const claims = new FakeClaims();
  const storage = new InMemoryObjectStorage();
  const logger = { info: vi.fn(), warn: vi.fn() };
  const runner = { withoutTenant: (work: (tx: unknown) => Promise<unknown>) => work({}), withTenant: (_t: string, work: (tx: unknown) => Promise<unknown>) => work({}) };
  const job = new DataExportJob(
    runner as unknown as WorkerTransactionRunner,
    claims as unknown as DataExportClaimsRepository,
    builder as unknown as ExportArchiveBuilder,
    storage,
    new YazlZipArchiveFactory(),
    clock as unknown as Clock,
    logger as unknown as JsonLogger,
    { DATA_EXPORT_MAX_RUN_MS: 4 * 3_600_000, DATA_EXPORT_MAX_BYTES: 100 * 1024 ** 3, ...settings } as WorkerSettings,
  );
  return { job, claims, storage, logger, advance: (ms: number) => (now += ms) };
}

describe('DataExportJob', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces what an earlier attempt left, writes the zip and finishes with its size, checksum and counts', async () => {
    const { job, claims, storage } = setup(fakeBuilder(3));
    storage.seed(KEY, Buffer.from('leftover of attempt 1'));
    expect(await job.runOnce()).toEqual({ claimed: 1, ready: 1, failed: 0 });

    const object = await storage.read(KEY, 10_000_000);
    expect((await readZip(object)).map((entry) => entry.name)).toEqual(['data/part-0.txt', 'data/part-1.txt', 'data/part-2.txt']);
    expect(claims.finished).toEqual([{ sizeBytes: object.length, sha256: createHash('sha256').update(object).digest('hex'), counts: { tickets: 2, files: 0, missing_files: 0 } }]);
    expect(storage.multipart).toEqual({ opened: 1, completed: 1, aborted: 0 });
    expect(claims.claimDue).toHaveBeenCalledWith({}, 1, 30);
  });

  it('deletes the object when finish is refused (the claim is not ours any more, or the purge is due)', async () => {
    const { job, claims, storage } = setup(fakeBuilder(2));
    claims.finishResult = false;
    expect(await job.run(CLAIM)).toBe('discarded');
    expect(storage.has(KEY)).toBe(false);
    expect(claims.failures).toEqual([]);
  });

  it('stops writing as soon as the heartbeat is refused, aborts the upload and leaves no object', async () => {
    let writesAfterLoss = 0;
    let lost = false;
    const { job, claims, storage } = setup(
      fakeBuilder(50, (index) => {
        if (lost) writesAfterLoss += 1;
        if (index === 3) {
          lost = true;
          vi.advanceTimersByTime(EXPORT_HEARTBEAT_MS);
        }
      }),
    );
    claims.renewals = [false];
    expect(await job.run(CLAIM)).toBe('failed');
    expect(writesAfterLoss).toBeLessThanOrEqual(1);
    expect(storage.multipart).toEqual({ opened: 1, completed: 0, aborted: 1 });
    expect(storage.has(KEY)).toBe(false);
    expect(claims.finished).toEqual([]);
    expect(claims.failures).toEqual([{ code: 'LEASE_LOST', retryAt: new Date(START + 5 * 60_000) }]);
  });

  it('renews right before the object becomes visible, and never completes if that renewal is refused', async () => {
    const { job, claims, storage } = setup(fakeBuilder(2));
    claims.renewals = [false];
    expect(await job.run(CLAIM)).toBe('failed');
    expect(storage.multipart).toEqual({ opened: 1, completed: 0, aborted: 1 });
    expect(storage.has(KEY)).toBe(false);
    expect(claims.failures.map((failure) => failure.code)).toEqual(['LEASE_LOST']);
  });

  it('does not complete when the renewal before completing throws (no fresh lease, no object)', async () => {
    const { job, claims, storage } = setup(fakeBuilder(2));
    claims.renewals = [new Error('db down')];
    expect(await job.run(CLAIM)).toBe('failed');
    expect(storage.multipart).toEqual({ opened: 1, completed: 0, aborted: 1 });
    expect(storage.has(KEY)).toBe(false);
    expect(claims.failures.map((failure) => failure.code)).toEqual(['EXPORT_FAILED']);
  });

  it('deletes the completed object when finish throws, so nothing is left behind an export that is not READY', async () => {
    const { job, claims, storage } = setup(fakeBuilder(2));
    claims.finishError = new Error('connection lost');
    expect(await job.run(CLAIM)).toBe('failed');
    expect(storage.multipart).toEqual({ opened: 1, completed: 1, aborted: 0 });
    expect(storage.has(KEY)).toBe(false);
    expect(claims.failures.map((failure) => failure.code)).toEqual(['EXPORT_FAILED']);
  });

  it('fails for good when the archive passes the size cap', async () => {
    const { job, claims, storage } = setup(fakeBuilder(20, () => undefined, 50_000), { DATA_EXPORT_MAX_BYTES: 100_000 });
    expect(await job.run(CLAIM)).toBe('failed');
    expect(claims.failures).toEqual([{ code: 'EXPORT_TOO_LARGE', retryAt: null }]);
    expect(storage.multipart.aborted).toBe(1);
    expect(storage.has(KEY)).toBe(false);
  });

  it('fails for good when the time budget runs out', async () => {
    let advance: (ms: number) => void = () => undefined;
    const context = setup(fakeBuilder(10, (index) => index === 4 && advance(4 * 3_600_000 + 1)));
    advance = context.advance;
    expect(await context.job.run(CLAIM)).toBe('failed');
    expect(context.claims.failures).toEqual([{ code: 'EXPORT_TIMEOUT', retryAt: null }]);
    expect(context.storage.multipart.aborted).toBe(1);
  });

  it('stops between writes when the worker shuts down, and asks to be tried again soon', async () => {
    const stop = new AbortController();
    const { job, claims, storage } = setup(fakeBuilder(10, (index) => index === 2 && stop.abort(new ExportStoppedError())));
    expect(await job.run(CLAIM, stop.signal)).toBe('failed');
    expect(claims.failures).toEqual([{ code: 'WORKER_STOPPED', retryAt: new Date(START + 60_000) }]);
    expect(storage.multipart.aborted).toBe(1);
  });

  it('records a code and logs ids only, never the error message', async () => {
    const { job, claims, logger } = setup({
      build: async (zip: ZipArchive) => {
        zip.destroy(new Error('x'));
        throw new Error('ticket "Despido de Juan" has a secret');
      },
    } as unknown as ReturnType<typeof fakeBuilder>);
    expect(await job.run(CLAIM)).toBe('failed');
    expect(claims.failures.map((failure) => failure.code)).toEqual(['EXPORT_FAILED']);
    expect(logger.warn).toHaveBeenCalledWith('data_export.failed', expect.objectContaining({ event: 'data_export.failed', code: 'EXPORT_FAILED', exportId: CLAIM.exportId, errorName: 'Error' }));
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/Juan|secret/);
  });

  it('claims nothing once the worker is stopping', async () => {
    const stop = new AbortController();
    stop.abort();
    const { job, claims } = setup(fakeBuilder(1));
    expect(await job.runOnce(stop.signal)).toEqual({ claimed: 0, ready: 0, failed: 0 });
    expect(claims.claimDue).not.toHaveBeenCalled();
  });
});
