import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import { ExportStoppedError } from '../domain/export-errors.js';
import type { DataExportJob } from './data-export.job.js';
import { DATA_EXPORT_CHECK_INTERVAL_MS, DataExportScheduler } from './data-export.scheduler.js';

describe('DataExportScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once per minute, never two runs at once', async () => {
    let release: () => void = () => undefined;
    const runOnce = vi.fn(() => new Promise<{ claimed: number; ready: number; failed: number }>((resolve) => (release = () => resolve({ claimed: 1, ready: 1, failed: 0 }))));
    const scheduler = new DataExportScheduler({ runOnce } as unknown as DataExportJob, { info: vi.fn(), warn: vi.fn() } as unknown as JsonLogger);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(DATA_EXPORT_CHECK_INTERVAL_MS * 3);
    expect(runOnce).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(DATA_EXPORT_CHECK_INTERVAL_MS);
    expect(runOnce).toHaveBeenCalledTimes(2);
    release();
    await scheduler.beforeApplicationShutdown();
  });

  it('on shutdown stops the export in progress (WORKER_STOPPED) and waits for it to clean up', async () => {
    let signal: AbortSignal | undefined;
    let cleanedUp = false;
    const runOnce = vi.fn(async (stop: AbortSignal) => {
      signal = stop;
      await new Promise((resolve) => stop.addEventListener('abort', resolve));
      cleanedUp = true;
      return { claimed: 1, ready: 0, failed: 1 };
    });
    const scheduler = new DataExportScheduler({ runOnce } as unknown as DataExportJob, { info: vi.fn(), warn: vi.fn() } as unknown as JsonLogger);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(DATA_EXPORT_CHECK_INTERVAL_MS);
    expect(signal?.aborted).toBe(false);
    await scheduler.beforeApplicationShutdown();
    expect(signal?.reason).toBeInstanceOf(ExportStoppedError);
    expect(cleanedUp).toBe(true);
    await vi.advanceTimersByTimeAsync(DATA_EXPORT_CHECK_INTERVAL_MS * 2);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });
});
