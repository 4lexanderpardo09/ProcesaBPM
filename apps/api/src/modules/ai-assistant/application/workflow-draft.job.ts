import { Inject, Injectable } from '@nestjs/common';
import { type AiDraftResult, type DraftPreview, type DraftSpecLoss, ImmutableDataError, isFormatTaskKind, NotFoundError, StaleRevisionError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { type LlmDelivery, LlmProvider } from '../../../infrastructure/llm/llm-provider.js';
import { DraftDocumentImporter, DraftImportRejectedError } from '../../workflows/application/draft-document-importer.js';
import { type AiJobClaim, AiJobClaimsRepository, type AiJobProgress } from '../data/ai-job-claims.repository.js';
import { AiJobWorkRepository, type DraftJobInput } from '../data/ai-job-work.repository.js';
import { type CallRecord, DraftDesigner } from './draft-designer.js';
import { DraftTaskReader } from './draft-task.reader.js';
import { AI_JOB_LEASE_MINUTES, type AiJobOutcome } from './ai-job-lease.js';
import { FormatDraftJob } from './format-draft.job.js';

export { AI_JOB_LEASE_MINUTES, type AiJobOutcome } from './ai-job-lease.js';

/** One request at a time per worker process: each one is minutes of paid calls. */
export const AI_JOBS_PER_RUN = 1;
const NOT_STOPPED: AbortSignal = new AbortController().signal;


class ClaimLostError extends Error {
  constructor() {
    super('The AI request is not ours any more');
    this.name = 'ClaimLostError';
  }
}

/**
 * Turns due «Crear con IA» requests into drafts (new ones, or the current one with a change) (docs/arquitectura.md §22): claims one, lets the designer talk to the
 * model round by round (lease renewed before each call, every call written to the ledger right away), then writes the
 * draft and finishes the request in one tenant transaction, so the draft never changes without the request saying so.
 * Logs carry ids, codes and token counts, never the description or the model's answer.
 */
@Injectable()
export class WorkflowDraftJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(AiJobClaimsRepository) private readonly claims: AiJobClaimsRepository,
    @Inject(AiJobWorkRepository) private readonly work: AiJobWorkRepository,
    @Inject(DraftTaskReader) private readonly tasks: DraftTaskReader,
    @Inject(DraftDocumentImporter) private readonly importer: DraftDocumentImporter,
    @Inject(DraftDesigner) private readonly designer: DraftDesigner,
    @Inject(LlmProvider) private readonly provider: LlmProvider,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(FormatDraftJob) private readonly formats: FormatDraftJob,
  ) {}

  async runOnce(stop: AbortSignal = NOT_STOPPED): Promise<{ claimed: number; succeeded: number; failed: number }> {
    if (stop.aborted) return { claimed: 0, succeeded: 0, failed: 0 };
    const claims = await this.runner.withoutTenant((tx) => this.claims.claimDue(tx, AI_JOBS_PER_RUN, AI_JOB_LEASE_MINUTES));
    let succeeded = 0;
    let failed = 0;
    for (const claim of claims) {
      const outcome = await this.dispatch(claim, stop);
      if (outcome === 'succeeded') succeeded += 1;
      if (outcome === 'failed') failed += 1;
    }
    return { claimed: claims.length, succeeded, failed };
  }

  /** A format request goes to its own job; a workflow draft is done here. */
  private async dispatch(claim: AiJobClaim, stop: AbortSignal): Promise<AiJobOutcome> {
    const kind = await this.runner.withTenant(claim.tenantId, (tx) => this.work.kindOf(tx, claim.tenantId, claim.jobId));
    return kind !== undefined && isFormatTaskKind(kind) ? this.formats.run(claim, stop) : this.run(claim, stop);
  }

  async run(claim: AiJobClaim, stop: AbortSignal = NOT_STOPPED): Promise<AiJobOutcome> {
    const read = await this.runner.withTenant(claim.tenantId, (tx) => this.tasks.read(tx, claim.tenantId, claim.jobId));
    if (read.kind === 'failed') return this.fail(claim, read.errorCode);
    const { input, catalog, task } = read;
    const previews = new PreviewWriter((round, preview) => this.runner.withoutTenant((tx) => this.claims.setPreview(tx, claim, round, preview)), (error) =>
      this.log('warn', 'ai_job.preview_not_recorded', claim, { errorName: error instanceof Error ? error.name : typeof error }),
    );

    const result = await this.designer.design(
      task,
      catalog,
      {
        beforeRound: (round) => this.renewAndShow(claim, { stage: 'DESIGNING', round }),
        afterReview: (round, problems) => this.show(claim, { stage: 'REVIEWING', round, problems }),
        afterCall: (call) => this.record(claim, input, call),
        onPreview: (round, preview) => previews.show(round, preview),
      },
      stop,
    );
    await previews.settled();
    if (previews.counts.written + previews.counts.refused + previews.counts.failed > 0) this.log('info', 'ai_job.previews', claim, { ...previews.counts });
    if (result.kind === 'interrupted') {
      this.log('info', 'ai_job.interrupted', claim);
      return 'interrupted';
    }
    if (result.kind === 'failed') return this.fail(claim, result.errorCode);
    if (!(await this.show(claim, { stage: 'WRITING', round: result.rounds }))) {
      this.log('info', 'ai_job.interrupted', claim);
      return 'interrupted';
    }

    try {
      await this.runner.withTenant(claim.tenantId, async (tx) => {
        const written = await this.importer.replaceContent(tx, { tenantId: claim.tenantId, workflowId: input.workflowId, versionId: input.versionId, expectedRevision: input.expectedRevision, document: result.document });
        const summary: AiDraftResult = {
          revision: written.revision,
          assumptions: [...result.summary.assumptions],
          decisions: [...result.summary.decisions],
          outline: result.summary.outline,
          corrections: result.corrections,
          keptSettings: result.summary.keptSettings.map(mutableLoss),
          droppedSettings: result.summary.droppedSettings.map(mutableLoss),
          rounds: result.rounds,
          errors: written.validation.errors.length, warnings: written.validation.warnings.length };
        if (!(await this.claims.finish(tx, claim, summary))) throw new ClaimLostError();
      });
    } catch (error) {
      if (error instanceof ClaimLostError) {
        this.log('info', 'ai_job.interrupted', claim);
        return 'interrupted';
      }
      return this.fail(claim, importFailureCode(error), error);
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

  /**
   * Writes a paid call to the ledger. Never throws: if the ledger refuses it, the token counts go to the log (so the
   * cost can still be reconciled) and the designer goes on; the next lease renewal tells it whether to stop.
   */
  private async record(claim: AiJobClaim, input: DraftJobInput, call: CallRecord): Promise<void> {
    const facts = { round: call.round, outcome: call.outcome, errorCode: call.errorCode, promptTokens: call.usage.promptTokens, cachedPromptTokens: call.usage.cachedPromptTokens, completionTokens: call.usage.completionTokens, reasoningTokens: call.usage.reasoningTokens, durationMs: call.durationMs, previews: call.previews ?? 0, ...deliveryFacts(call.delivery) };
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

  private async fail(claim: AiJobClaim, code: string, cause?: unknown): Promise<AiJobOutcome> {
    this.log('warn', 'ai_job.failed', claim, { code, ...(cause instanceof Error ? { errorName: cause.name } : {}) });
    try {
      await this.runner.withoutTenant((tx) => this.claims.fail(tx, claim, code));
    } catch (recordError) {
      // The lease then expires and the request is tried once more, or ends LEASE_EXPIRED.
      this.log('warn', 'ai_job.fail_not_recorded', claim, { errorName: recordError instanceof Error ? recordError.name : typeof recordError });
    }
    return 'failed';
  }

  private log(level: 'info' | 'warn', event: string, claim: AiJobClaim, extra: Record<string, unknown> = {}): void {
    this.logger[level](event, { event, tenantId: claim.tenantId, jobId: claim.jobId, attempt: claim.attempt, ...extra });
  }
}

const mutableLoss = (loss: DraftSpecLoss) => ({ ...loss, properties: [...loss.properties] });

/**
 * Writes the diagram so far one at a time, outside the call it comes from: while one is being written, a newer one
 * waits and replaces any older one still waiting. A preview that cannot be written is only logged: it is never worth a
 * request.
 */
class PreviewWriter {
  private writing: Promise<void> = Promise.resolve();
  private waiting: { round: number; preview: DraftPreview } | undefined;
  private busy = false;
  /** Written; refused by the database (the round was already over); failed. For the log. */
  readonly counts = { written: 0, refused: 0, failed: 0 };

  constructor(
    private readonly write: (round: number, preview: DraftPreview) => Promise<boolean>,
    private readonly onError: (error: unknown) => void,
  ) {}

  show(round: number, preview: DraftPreview): void {
    this.waiting = { round, preview };
    if (!this.busy) this.writing = this.drain();
  }

  /** Waits for the last write, so none lands after the request moves on. */
  settled(): Promise<void> {
    return this.writing;
  }

  private async drain(): Promise<void> {
    this.busy = true;
    while (this.waiting !== undefined) {
      const { round, preview } = this.waiting;
      this.waiting = undefined;
      try {
        if (await this.write(round, preview)) this.counts.written += 1;
        else this.counts.refused += 1;
      } catch (error) {
        this.counts.failed += 1;
        this.onError(error);
      }
    }
    this.busy = false;
  }
}

/** How a call's answer arrived, flat for the log: it tells whether the arguments streamed or came all at once. */
function deliveryFacts(delivery: LlmDelivery | undefined): Record<string, unknown> {
  if (delivery === undefined) return {};
  return {
    contentType: delivery.contentType,
    streamed: delivery.streamed,
    reasoningChunks: delivery.reasoningChunks,
    argumentChunks: delivery.argumentChunks,
    firstArgumentMs: delivery.firstArgumentMs,
    lastArgumentMs: delivery.lastArgumentMs,
  };
}

/** Why writing the draft failed, as the code the person sees. */
function importFailureCode(error: unknown): string {
  if (error instanceof StaleRevisionError) return 'DRAFT_CHANGED';
  if (error instanceof NotFoundError || error instanceof ImmutableDataError) return 'DRAFT_GONE';
  if (error instanceof DraftImportRejectedError) return 'AI_DRAFT_INVALID';
  return 'DRAFT_WRITE_FAILED';
}
