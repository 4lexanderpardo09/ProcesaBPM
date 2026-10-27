import { buildDraftToolSchema, checkDraftSpec, type DraftCatalog, describeSpecProblems, describeWorkflowProblems, type WorkflowDraftSpec, workflowDraftSpecSchema, type WorkflowVersionDocument } from '@procesabpm/shared';
import { LlmCallError, type LlmFailureKind, type LlmProvider, type LlmResult, type LlmUsage, NO_USAGE } from '../../../infrastructure/llm/llm-provider.js';
import { blockingProblems } from '../../workflows/application/draft-document-importer.js';
import { buildDraftPrompt, DRAFT_TOOL_DESCRIPTION, DRAFT_TOOL_NAME, type DraftCorrection } from '../domain/prompt-builder.js';

export type CallOutcome = 'OK' | 'TOOL_NOT_CALLED' | 'INVALID_OUTPUT' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'ABORTED';

/** One call to the provider, as the usage ledger records it. */
export interface CallRecord {
  readonly round: number;
  readonly outcome: CallOutcome;
  readonly usage: LlmUsage;
  readonly durationMs: number;
  readonly errorCode: string | null;
}

export interface DesignHooks {
  /** Before each call (renews the job's lease). `false`: the job is not ours any more, stop. */
  readonly beforeRound: () => Promise<boolean>;
  /** After each call, answered or not: every call is paid and recorded. */
  readonly afterCall: (call: CallRecord) => Promise<void>;
}

export type DesignResult =
  | { readonly kind: 'draft'; readonly document: WorkflowVersionDocument; readonly assumptions: readonly string[]; readonly rounds: number; readonly errors: number; readonly warnings: number }
  | { readonly kind: 'failed'; readonly errorCode: 'AI_DRAFT_INVALID' | 'AI_PROVIDER_FAILED' | 'AI_NOT_CONFIGURED' }
  /** The lease was lost or the worker is stopping: nothing is recorded as the job's outcome. */
  | { readonly kind: 'interrupted' };

interface Candidate {
  readonly document: WorkflowVersionDocument;
  readonly assumptions: readonly string[];
  readonly errors: number;
  readonly warnings: number;
}

interface Evaluation {
  readonly outcome: CallOutcome;
  readonly candidate?: Candidate;
  readonly correction: DraftCorrection;
}

const FAILURE_OUTCOME: Readonly<Record<LlmFailureKind, CallOutcome>> = { TIMEOUT: 'TIMEOUT', RATE_LIMITED: 'RATE_LIMITED', PROVIDER_ERROR: 'PROVIDER_ERROR', ABORTED: 'ABORTED', NOT_CONFIGURED: 'PROVIDER_ERROR' };
const TOOL_NOT_CALLED_PROBLEM = `You answered without calling the tool ${DRAFT_TOOL_NAME}. Call it with the whole draft.`;

/**
 * Asks the model for a workflow draft and corrects it: each round is one call; the answer is checked with the same
 * rules publishing uses, and its problems go back to the model in the next round. It keeps the last draft the
 * database would accept, and stops early once a draft has no problems at all. Pure orchestration: the caller owns the
 * lease, the ledger and the writing of the draft.
 */
export class DraftDesigner {
  constructor(
    private readonly provider: LlmProvider,
    private readonly maxRounds: number,
  ) {}

  async design(description: string, catalog: DraftCatalog, hooks: DesignHooks, signal: AbortSignal): Promise<DesignResult> {
    const tool = { name: DRAFT_TOOL_NAME, description: DRAFT_TOOL_DESCRIPTION, schema: buildDraftToolSchema(catalog) };
    let correction: DraftCorrection | undefined;
    let best: Candidate | undefined;
    let answered = false;
    for (let round = 1; round <= this.maxRounds; round += 1) {
      if (signal.aborted || !(await hooks.beforeRound())) return { kind: 'interrupted' };
      let result: LlmResult;
      try {
        result = await this.provider.complete({ ...buildDraftPrompt(description, catalog, correction), tool }, signal);
      } catch (error) {
        if (!(error instanceof LlmCallError)) throw error;
        await hooks.afterCall({ round, outcome: FAILURE_OUTCOME[error.kind], usage: NO_USAGE, durationMs: error.durationMs, errorCode: error.status === undefined ? error.kind : `HTTP_${error.status}` });
        if (error.kind === 'NOT_CONFIGURED') return { kind: 'failed', errorCode: 'AI_NOT_CONFIGURED' };
        if (error.kind === 'ABORTED') return { kind: 'interrupted' };
        continue;
      }
      answered = true;
      const evaluation = this.evaluate(result, catalog);
      await hooks.afterCall({ round, outcome: evaluation.outcome, usage: result.usage, durationMs: result.durationMs, errorCode: null });
      if (evaluation.candidate !== undefined) {
        best = evaluation.candidate;
        if (best.errors === 0) return { kind: 'draft', ...best, rounds: round };
      }
      correction = evaluation.correction;
    }
    if (best !== undefined) return { kind: 'draft', ...best, rounds: this.maxRounds };
    return { kind: 'failed', errorCode: answered ? 'AI_DRAFT_INVALID' : 'AI_PROVIDER_FAILED' };
  }

  private evaluate(result: LlmResult, catalog: DraftCatalog): Evaluation {
    if (result.answer.kind === 'no_tool_call') return { outcome: 'TOOL_NOT_CALLED', correction: { previous: null, problems: [TOOL_NOT_CALLED_PROBLEM] } };
    const parsed = workflowDraftSpecSchema.safeParse(result.answer.arguments);
    if (!parsed.success) {
      return { outcome: 'INVALID_OUTPUT', correction: { previous: null, problems: parsed.error.issues.slice(0, 30).map((issue) => `${issue.path.join('.') || 'draft'}: ${issue.message}`) } };
    }
    const spec: WorkflowDraftSpec = parsed.data;
    const check = checkDraftSpec(spec, catalog);
    if (check.kind === 'untranslatable') return { outcome: 'OK', correction: { previous: spec, problems: describeSpecProblems(check.problems, spec) } };
    const correction = { previous: spec, problems: describeWorkflowProblems(check.errors, check.document) };
    if (blockingProblems(check.document).length > 0) return { outcome: 'OK', correction };
    return { outcome: 'OK', correction, candidate: { document: check.document, assumptions: spec.assumptions, errors: check.errors.length, warnings: check.warnings.length } };
  }
}
