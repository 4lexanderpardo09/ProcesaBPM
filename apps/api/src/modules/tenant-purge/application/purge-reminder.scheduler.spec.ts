import { describe, expect, it } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import type { PurgeReminderRepository } from '../data/purge-reminder.repository.js';
import { PurgeReminderScheduler } from './purge-reminder.scheduler.js';

const schedulerWith = (batches: number[]) => {
  const calls: number[] = [];
  const runner = { withoutTenant: (work: (tx: never) => Promise<number>) => work(undefined as never) } as unknown as WorkerTransactionRunner;
  const reminders = {
    enqueueDue: async (_tx: unknown, limit: number) => {
      calls.push(limit);
      return batches.shift() ?? 0;
    },
  } as unknown as PurgeReminderRepository;
  return { scheduler: new PurgeReminderScheduler(runner, reminders, {} as JsonLogger), calls };
};

describe('PurgeReminderScheduler.runOnce', () => {
  it('keeps calling while a call fills its batch, and stops at the first partial one', async () => {
    const { scheduler, calls } = schedulerWith([100, 100, 3]);
    expect(await scheduler.runOnce()).toBe(203);
    expect(calls).toEqual([100, 100, 100]);
  });

  it('never loops forever: at most 10 calls per run', async () => {
    const { scheduler, calls } = schedulerWith(Array.from({ length: 50 }, () => 100));
    expect(await scheduler.runOnce()).toBe(1000);
    expect(calls).toHaveLength(10);
  });
});
