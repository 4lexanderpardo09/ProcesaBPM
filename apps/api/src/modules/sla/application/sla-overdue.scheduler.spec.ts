import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import { OVERDUE_CHECK_INTERVAL_MS, SlaOverdueScheduler } from './sla-overdue.scheduler.js';
import type { SlaOverdueJob } from './sla-overdue.job.js';

describe('SlaOverdueScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (runOnce: () => Promise<number>) => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const job = { runOnce: vi.fn(runOnce) };
    return { logger, job, scheduler: new SlaOverdueScheduler(job as unknown as SlaOverdueJob, logger as unknown as JsonLogger) };
  };

  it('runs the job every minute and stops at shutdown', async () => {
    const { scheduler, job } = setup(() => Promise.resolve(0));
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(OVERDUE_CHECK_INTERVAL_MS * 2);
    expect(job.runOnce).toHaveBeenCalledTimes(2);
    await scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(OVERDUE_CHECK_INTERVAL_MS * 2);
    expect(job.runOnce).toHaveBeenCalledTimes(2);
  });

  it('logs what it alerted, and nothing when there was nothing', async () => {
    const quiet = setup(() => Promise.resolve(0));
    await quiet.scheduler.tick();
    expect(quiet.logger.log).not.toHaveBeenCalled();
    const busy = setup(() => Promise.resolve(3));
    await busy.scheduler.tick();
    expect(busy.logger.log).toHaveBeenCalledWith('Alerted 3 overdue SLA clocks', 'SlaOverdueScheduler');
  });

  it('survives a failing run', async () => {
    const { scheduler, logger } = setup(() => Promise.reject(new Error('db down')));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
