import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { RetentionJob } from './retention.job.js';
import { isWithinRetentionWindow, RETENTION_CHECK_INTERVAL_MS, RETENTION_FIRST_CHECK_DELAY_MS, RetentionScheduler } from './retention.scheduler.js';

describe('RetentionScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (runOnce: () => Promise<unknown>, now = new Date('2026-10-03T07:30:00Z')) => {
    const logger = { error: vi.fn() };
    const job = { runOnce: vi.fn(runOnce) };
    const clock = { now: () => now };
    return { logger, job, scheduler: new RetentionScheduler(job as unknown as RetentionJob, clock as unknown as Clock, logger as unknown as JsonLogger) };
  };

  it('checks 10 minutes after start-up, then every hour, and stops at shutdown', async () => {
    const { scheduler, job } = setup(() => Promise.resolve(undefined));
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(RETENTION_FIRST_CHECK_DELAY_MS);
    expect(job.runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS);
    expect(job.runOnce).toHaveBeenCalledTimes(2);
    await scheduler.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS * 3);
    expect(job.runOnce).toHaveBeenCalledTimes(2);
  });

  it('only runs during the night window', async () => {
    const day = setup(() => Promise.resolve(undefined), new Date('2026-10-03T15:00:00Z'));
    await day.scheduler.tick();
    expect(day.job.runOnce).not.toHaveBeenCalled();
    expect([5, 6, 10, 11].map((hour) => isWithinRetentionWindow(new Date(Date.UTC(2026, 9, 3, hour, 59))))).toEqual([false, true, true, false]);
  });

  it('never starts a second run while one is still going', async () => {
    let finish: () => void = () => undefined;
    const { scheduler, job } = setup(() => new Promise<void>((resolve) => (finish = resolve)));
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(RETENTION_FIRST_CHECK_DELAY_MS + RETENTION_CHECK_INTERVAL_MS * 2);
    expect(job.runOnce).toHaveBeenCalledTimes(1);
    finish();
    await scheduler.beforeApplicationShutdown();
  });

  it('survives a failing run', async () => {
    const { scheduler, logger } = setup(() => Promise.reject(new Error('db down')));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
