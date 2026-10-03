import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import type { RetentionRepository } from '../data/retention.repository.js';
import { RETENTION_STEPS, type RetentionRunClaim, type RetentionRunSummary, type RetentionStep } from '../domain/retention-step.js';
import { RETENTION_BATCH_SIZE, RETENTION_MAX_BATCHES_PER_STEP, RETENTION_STEP_BUDGET_MS, RetentionJob } from './retention.job.js';

const RUN_ID = '0199a8f0-0000-7000-8000-000000000001';
const BLOCKING_RUN_START = new Date('2026-10-03T06:05:00Z');

/** A repository that hands out the given batch sizes per step (then 0), and can fail a step. */
class FakeRetentionRepository {
  readonly calls: Array<{ step: RetentionStep; limit: number }> = [];
  finished: RetentionRunSummary | undefined;

  constructor(
    private readonly batches: Partial<Record<RetentionStep, number[]>> = {},
    private readonly failing: Partial<Record<RetentionStep, Error>> = {},
    private readonly runId: string | null = RUN_ID,
    private readonly onBatch: () => void = () => undefined,
  ) {}

  startRun(): Promise<RetentionRunClaim> {
    return Promise.resolve(this.runId === null ? { kind: 'skipped', blockingStartedAt: BLOCKING_RUN_START } : { kind: 'started', runId: this.runId });
  }

  purgeBatch(_tx: unknown, step: RetentionStep, limit: number): Promise<number> {
    this.calls.push({ step, limit });
    this.onBatch();
    const failure = this.failing[step];
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve(this.batches[step]?.shift() ?? 0);
  }

  finishRun(_tx: unknown, summary: RetentionRunSummary): Promise<void> {
    this.finished = summary;
    return Promise.resolve();
  }
}

function setup(repository: FakeRetentionRepository, clock: { now: () => Date } = { now: () => new Date('2026-10-03T07:00:00Z') }) {
  const runner = { withoutTenant: vi.fn((work: (tx: unknown) => Promise<unknown>) => work({})) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const job = new RetentionJob(
    runner as unknown as WorkerTransactionRunner,
    repository as unknown as RetentionRepository,
    clock as unknown as Clock,
    logger as unknown as JsonLogger,
  );
  return { job, runner, logger };
}

const stepsCalled = (repository: FakeRetentionRepository) => repository.calls.map((call) => call.step);

describe('RetentionJob', () => {
  it('does nothing when another replica already started tonight’s run, and says which run blocks it', async () => {
    const repository = new FakeRetentionRepository({}, {}, null);
    const { job, logger } = setup(repository);
    expect(await job.runOnce()).toBeUndefined();
    expect(repository.calls).toEqual([]);
    expect(repository.finished).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('retention.run_skipped', { event: 'retention.run_skipped', blockingRunStartedAt: BLOCKING_RUN_START.toISOString() });
  });

  it('stops between batches when asked to (shutdown), records the run as interrupted and skips the remaining steps', async () => {
    const stop = new AbortController();
    const full = Array.from({ length: 10 }, () => RETENTION_BATCH_SIZE);
    const repository = new FakeRetentionRepository({ notifications: full }, {}, RUN_ID, () => {
      if (repository.calls.filter((call) => call.step === 'notifications').length === 2) stop.abort();
    });
    const { job } = setup(repository);

    const summary = await job.runOnce(stop.signal);

    expect(stepsCalled(repository)).toEqual(['outbox_events', 'platform_outbox_events', 'notifications', 'notifications']);
    expect(summary).toMatchObject({ interrupted: true, deleted: { outbox_events: 0, platform_outbox_events: 0, notifications: 2 * RETENTION_BATCH_SIZE } });
    expect(Object.keys(summary!.deleted)).toEqual(['outbox_events', 'platform_outbox_events', 'notifications']);
    expect(repository.finished).toEqual(summary);
  });

  it('does not start a step once stopped, but still records the run', async () => {
    const stop = new AbortController();
    stop.abort();
    const repository = new FakeRetentionRepository();
    const { job } = setup(repository);
    expect(await job.runOnce(stop.signal)).toMatchObject({ interrupted: true, deleted: {}, failed: [] });
    expect(repository.calls).toEqual([]);
  });

  it('runs every step once, in order, when nothing is due, and records the run', async () => {
    const repository = new FakeRetentionRepository();
    const { job } = setup(repository);
    const summary = await job.runOnce();
    expect(stepsCalled(repository)).toEqual([...RETENTION_STEPS]);
    expect(repository.calls.every((call) => call.limit === RETENTION_BATCH_SIZE)).toBe(true);
    expect(summary).toEqual(repository.finished);
    expect(summary).toMatchObject({ runId: RUN_ID, failed: [], interrupted: false, deleted: Object.fromEntries(RETENTION_STEPS.map((step) => [step, 0])) });
  });

  it('calls a step again while its batches come back full and stops at the first short one', async () => {
    const repository = new FakeRetentionRepository({ audit_logs: [RETENTION_BATCH_SIZE, RETENTION_BATCH_SIZE, 7] });
    const { job } = setup(repository);
    const summary = await job.runOnce();
    expect(stepsCalled(repository).filter((step) => step === 'audit_logs')).toHaveLength(3);
    expect(summary?.deleted.audit_logs).toBe(2 * RETENTION_BATCH_SIZE + 7);
  });

  it('bounds a step by its number of batches', async () => {
    const full = Array.from({ length: RETENTION_MAX_BATCHES_PER_STEP + 5 }, () => RETENTION_BATCH_SIZE);
    const repository = new FakeRetentionRepository({ notifications: full });
    const { job } = setup(repository);
    const summary = await job.runOnce();
    expect(stepsCalled(repository).filter((step) => step === 'notifications')).toHaveLength(RETENTION_MAX_BATCHES_PER_STEP);
    expect(summary?.deleted.notifications).toBe(RETENTION_MAX_BATCHES_PER_STEP * RETENTION_BATCH_SIZE);
  });

  it('bounds a step by its time budget', async () => {
    let now = Date.parse('2026-10-03T07:00:00Z');
    const clock = { now: () => new Date(now) };
    const full = Array.from({ length: 50 }, () => RETENTION_BATCH_SIZE);
    // Every batch takes a minute: the budget allows a few, then the step gives way to the next one.
    const repository = new FakeRetentionRepository({ refresh_sessions: full }, {}, RUN_ID, () => {
      now += 60_000;
    });
    const { job } = setup(repository, clock);
    await job.runOnce();
    expect(stepsCalled(repository).filter((step) => step === 'refresh_sessions')).toHaveLength(RETENTION_STEP_BUDGET_MS / 60_000);
    expect(stepsCalled(repository).at(-1)).toBe('platform_audit_logs');
  });

  it('logs a failing step without its error message, keeps what it deleted and goes on with the next steps', async () => {
    const failure = Object.assign(new Error('row (tenant, secret) violates something'), { code: '57014' });
    const repository = new FakeRetentionRepository({ user_tokens: [RETENTION_BATCH_SIZE] }, {}, RUN_ID);
    let calls = 0;
    const original = repository.purgeBatch.bind(repository);
    repository.purgeBatch = (tx, step, limit) => (step === 'user_tokens' && ++calls === 2 ? Promise.reject(failure) : original(tx, step, limit));
    const { job, logger } = setup(repository);

    const summary = await job.runOnce();

    expect(summary).toMatchObject({ failed: ['user_tokens'], deleted: { user_tokens: RETENTION_BATCH_SIZE } });
    expect(stepsCalled(repository).at(-1)).toBe('platform_audit_logs');
    expect(logger.warn).toHaveBeenCalledWith('retention.step_failed', {
      event: 'retention.step_failed',
      step: 'user_tokens',
      rows: RETENTION_BATCH_SIZE,
      sqlState: '57014',
      errorName: 'Error',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });

  it('records every failed step in the run summary', async () => {
    const repository = new FakeRetentionRepository({}, { outbox_events: new Error('a'), platform_audit_logs: new Error('b') });
    const { job } = setup(repository);
    expect((await job.runOnce())?.failed).toEqual(['outbox_events', 'platform_audit_logs']);
    expect(repository.finished?.failed).toEqual(['outbox_events', 'platform_audit_logs']);
  });

  it('logs counts only', async () => {
    const repository = new FakeRetentionRepository({ audit_logs: [3] });
    const { job, logger } = setup(repository);
    await job.runOnce();
    expect(logger.info).toHaveBeenCalledWith('retention.step_done', expect.objectContaining({ event: 'retention.step_done', step: 'audit_logs', rows: 3 }));
    expect(logger.info).toHaveBeenLastCalledWith('retention.run_done', expect.objectContaining({ event: 'retention.run_done', failed: [] }));
  });

  it('gives each batch its own transaction', async () => {
    const repository = new FakeRetentionRepository({ audit_logs: [RETENTION_BATCH_SIZE, 1] });
    const { job, runner } = setup(repository);
    await job.runOnce();
    // start + one per batch (the nine steps, audit_logs twice) + finish
    expect(runner.withoutTenant).toHaveBeenCalledTimes(1 + RETENTION_STEPS.length + 1 + 1);
  });
});
