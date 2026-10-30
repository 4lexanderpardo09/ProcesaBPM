import { Inject, Injectable } from '@nestjs/common';
import type { AiFormatResult } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { LlmProvider } from '../../../infrastructure/llm/llm-provider.js';
import { type AiJobClaim, AiJobClaimsRepository, type AiJobProgress } from '../data/ai-job-claims.repository.js';
import { AiJobWorkRepository, type FormatJobInput } from '../data/ai-job-work.repository.js';
import type { CallRecord } from './draft-designer.js';
import { FormatDesigner } from './format-designer.js';
import { FormatTaskReader } from './format-task.reader.js';
import { AI_JOB_LEASE_MINUTES, type AiJobOutcome } from './ai-job-lease.js';

const NOT_STOPPED: AbortSignal = new AbortController().signal;

/**
 * Turns a claimed format request into a PDF format (Jiro in the format designer): lets the designer talk to the model
 * round by round (lease renewed before each call, every call written to the ledger right away) and finishes the
 * request with the design as its result. Nothing else is written: the designer on screen loads the design as unsaved
 * changes, and the person saves it through the usual checks. Logs carry ids, codes and token counts, never the
 * description or the model's answer.
 */
@Injectable()
export class FormatDraftJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(AiJobClaimsRepository) private readonly claims: AiJobClaimsRepository,
    @Inject(AiJobWorkRepository) private readonly work: AiJobWorkRepository,
    @Inject(FormatTaskReader) private readonly tasks: FormatTaskReader,
    @Inject(FormatDesigner) private readonly designer: FormatDesigner,
    @Inject(LlmProvider) private readonly provider: LlmProvider,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async run(claim: AiJobClaim, stop: AbortSignal = NOT_STOPPED): Promise<AiJobOutcome> {
    const read = await this.runner.withTenant(claim.tenantId, (tx) => this.tasks.read(tx, claim.tenantId, claim.jobId));
    if (read.kind === 'failed') return this.fail(claim, read.errorCode);
    const { input, catalog, task, check } = read;

    const result = await this.designer.design(
      task,
      catalog,
      check,
      {
        beforeRound: (round) => this.renewAndShow(claim, { stage: 'DESIGNING', round }),
        afterReview: (round, problems) => this.show(claim, { stage: 'REVIEWING', round, problems }),
        afterCall: (call) => this.record(claim, input, call),
      },
      stop,
    );
    if (result.kind === 'interrupted') return this.interrupted(claim);
    if (result.kind === 'failed') return this.fail(claim, result.errorCode);
    if (!(await this.show(claim, { stage: 'WRITING', round: result.rounds }))) return this.interrupted(claim);

    const summary: AiFormatResult = {
      design: result.spec.design,
      assumptions: [...result.spec.assumptions],
      decisions: result.spec.decisions.map((decision) => ({ ...decision })),
      corrections: result.corrections,
      rounds: result.rounds,
      errors: result.errors,
      warnings: result.warnings,
    };
    try {
      const finished = await this.runner.withTenant(claim.tenantId, (tx) => this.claims.finish(tx, claim, summary));
      if (!finished) return this.interrupted(claim);
    } catch (error) {
      return this.fail(claim, 'DRAFT_WRITE_FAILED', error);
    }
    this.log('info', 'ai_job.succeeded', claim, { rounds: result.rounds, errors: result.errors });
    return 'succeeded';
  }

  /** Before each call: the lease (the heartbeat) and the round shown, in one short transaction. */
  private renewAndShow(claim: AiJobClaim, progress: AiJobProgress): Promise<boolean> {
    return this.runner.withoutTenant(async (tx) => (await this.claims.renew(tx, claim, AI_JOB_LEASE_MINUTES)) && this.claims.setStage(tx, claim, progress));
  }

  /** `false` when the request is not ours any more (cancelled, expired): the caller stops. */
  private show(claim: AiJobClaim, progress: AiJobProgress): Promise<boolean> {
    return this.runner.withoutTenant((tx) => this.claims.setStage(tx, claim, progress));
  }

  /** Writes a paid call to the ledger; never throws (a refused row goes to the log, so the cost can be reconciled). */
  private async record(claim: AiJobClaim, input: FormatJobInput, call: CallRecord): Promise<void> {
    const facts = { round: call.round, outcome: call.outcome, errorCode: call.errorCode, promptTokens: call.usage.promptTokens, cachedPromptTokens: call.usage.cachedPromptTokens, completionTokens: call.usage.completionTokens, durationMs: call.durationMs };
    try {
      await this.runner.withTenant(claim.tenantId, (tx) =>
        this.work.recordUsage(tx, { taskKind: input.kind, tenantId: claim.tenantId, jobId: claim.jobId, userId: input.requestedById, provider: this.provider.name, model: this.provider.model, jobAttempt: claim.attempt, ...call }),
      );
    } catch (error) {
      this.log('warn', 'ai_job.usage_not_recorded', claim, { ...facts, provider: this.provider.name, model: this.provider.model, errorName: error instanceof Error ? error.name : typeof error });
      return;
    }
    this.log('info', 'ai_job.call', claim, facts);
  }

  private interrupted(claim: AiJobClaim): AiJobOutcome {
    this.log('info', 'ai_job.interrupted', claim);
    return 'interrupted';
  }

  private async fail(claim: AiJobClaim, code: string, cause?: unknown): Promise<AiJobOutcome> {
    this.log('warn', 'ai_job.failed', claim, { code, ...(cause instanceof Error ? { errorName: cause.name } : {}) });
    try {
      await this.runner.withoutTenant((tx) => this.claims.fail(tx, claim, code));
    } catch (recordError) {
      this.log('warn', 'ai_job.fail_not_recorded', claim, { errorName: recordError instanceof Error ? recordError.name : typeof recordError });
    }
    return 'failed';
  }

  private log(level: 'info' | 'warn', event: string, claim: AiJobClaim, extra: Record<string, unknown> = {}): void {
    this.logger[level](event, { event, tenantId: claim.tenantId, jobId: claim.jobId, attempt: claim.attempt, task: 'pdf_format', ...extra });
  }
}
