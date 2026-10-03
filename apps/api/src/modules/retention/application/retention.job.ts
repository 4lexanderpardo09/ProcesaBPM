import { Inject, Injectable } from '@nestjs/common';
import { extractSqlState } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { RetentionRepository } from '../data/retention.repository.js';
import { RETENTION_STEPS, type RetentionRunSummary, type RetentionStep } from '../domain/retention-step.js';

/** Rows per call: one short transaction each, so no lock is held for long. */
export const RETENTION_BATCH_SIZE = 5_000;
/** A step stops after this many batches or this much time, whichever comes first; the rest waits for the next night. */
export const RETENTION_MAX_BATCHES_PER_STEP = 200;
export const RETENTION_STEP_BUDGET_MS = 3 * 60_000;
export const RETENTION_BATCH_TIMEOUT_MS = 60_000;

interface StepResult {
  readonly deleted: number;
  readonly failed: boolean;
}

const NOT_STOPPED: AbortSignal = new AbortController().signal;

/**
 * Deletes what is past its retention window, step by step (`RETENTION_STEPS`), in batches until a batch comes back short
 * or the step's budget runs out. One run per night across every replica: `retention_start_run` hands the run to one of
 * them. A failing step is logged and the run goes on with the next one. The counts end in the platform trail
 * (`retention.run_finished`); the log carries counts and error codes only, never a row. A stop signal (worker shutdown)
 * is honoured between batches: the batch in flight finishes, the run is recorded as interrupted and the job returns.
 */
@Injectable()
export class RetentionJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(RetentionRepository) private readonly retention: RetentionRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /** `undefined`: another replica already ran tonight. */
  async runOnce(signal: AbortSignal = NOT_STOPPED): Promise<RetentionRunSummary | undefined> {
    const claim = await this.runner.withoutTenant((tx) => this.retention.startRun(tx));
    if (claim.kind === 'skipped') {
      this.logger.info('retention.run_skipped', { event: 'retention.run_skipped', blockingRunStartedAt: claim.blockingStartedAt.toISOString() });
      return undefined;
    }
    const startedAt = this.clock.now().getTime();
    const deleted: Partial<Record<RetentionStep, number>> = {};
    const failed: RetentionStep[] = [];
    for (const step of RETENTION_STEPS) {
      if (signal.aborted) break;
      const result = await this.runStep(step, signal);
      deleted[step] = result.deleted;
      if (result.failed) failed.push(step);
    }
    const summary: RetentionRunSummary = { runId: claim.runId, deleted, failed, durationMs: this.clock.now().getTime() - startedAt, interrupted: signal.aborted };
    await this.runner.withoutTenant((tx) => this.retention.finishRun(tx, summary));
    this.logger.info('retention.run_done', { event: 'retention.run_done', deleted, failed, durationMs: summary.durationMs, interrupted: summary.interrupted });
    return summary;
  }

  private async runStep(step: RetentionStep, signal: AbortSignal): Promise<StepResult> {
    const startedAt = this.clock.now().getTime();
    let deleted = 0;
    try {
      for (let batch = 0; batch < RETENTION_MAX_BATCHES_PER_STEP; batch += 1) {
        const rows = await this.runner.withoutTenant((tx) => this.retention.purgeBatch(tx, step, RETENTION_BATCH_SIZE), { timeoutMs: RETENTION_BATCH_TIMEOUT_MS });
        deleted += rows;
        if (rows < RETENTION_BATCH_SIZE || signal.aborted || this.clock.now().getTime() - startedAt >= RETENTION_STEP_BUDGET_MS) break;
      }
      this.logger.info('retention.step_done', { event: 'retention.step_done', step, rows: deleted, ms: this.clock.now().getTime() - startedAt });
      return { deleted, failed: false };
    } catch (error) {
      this.logger.warn('retention.step_failed', {
        event: 'retention.step_failed',
        step,
        rows: deleted,
        sqlState: extractSqlState(error) ?? null,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return { deleted, failed: true };
    }
  }
}
