import { buildFormatToolSchema, completeFormatAnswer, type FormatDraftSpec, formatDraftSpecSchema, type PdfCanvasDesign, type PdfProblem } from '@procesabpm/shared';
import { LlmCallError, type LlmProvider, type LlmResult, NO_USAGE } from '../../../infrastructure/llm/llm-provider.js';
import { buildFormatPrompt, type FormatCatalog, type FormatCorrection, FORMAT_TOOL_DESCRIPTION, FORMAT_TOOL_NAME, type FormatTask } from '../domain/format-prompt.js';
import type { CallOutcome, DesignHooks } from './draft-designer.js';

/** A design checked like one saved by hand: errors block saving it, warnings the next publication. */
export interface FormatCheck {
  readonly errors: readonly PdfProblem[];
  readonly warnings: readonly PdfProblem[];
}

export type FormatDesignResult =
  | { readonly kind: 'format'; readonly spec: FormatDraftSpec; readonly rounds: number; readonly corrections: number; readonly errors: number; readonly warnings: number }
  | { readonly kind: 'failed'; readonly errorCode: 'AI_DRAFT_INVALID' | 'AI_PROVIDER_FAILED' | 'AI_NOT_CONFIGURED' }
  | { readonly kind: 'interrupted' };

interface Candidate {
  readonly spec: FormatDraftSpec;
  readonly errors: number;
  readonly warnings: number;
}

const FAILURE_OUTCOME = { TIMEOUT: 'TIMEOUT', RATE_LIMITED: 'RATE_LIMITED', PROVIDER_ERROR: 'PROVIDER_ERROR', ABORTED: 'ABORTED', NOT_CONFIGURED: 'PROVIDER_ERROR' } as const satisfies Record<LlmCallError['kind'], CallOutcome>;
const TOOL_NOT_CALLED_PROBLEM = `You answered without calling the tool ${FORMAT_TOOL_NAME}. Call it with the whole format.`;

/** What a problem code means, said to the model so it can fix it. */
const PROBLEM_HINTS: Readonly<Record<string, string>> = {
  DOCUMENT_FIELD_UNKNOWN: 'no such field in the catalog',
  DOCUMENT_FIELD_TYPE_MISMATCH: 'wrong kind of field here',
  DOCUMENT_ROW_OUTSIDE_TABLE: '{{row.…}} only works inside a table column',
  DOCUMENT_TABLE_COLUMN_UNKNOWN: 'no such column in that table field',
  DOCUMENT_CALCULATION_UNKNOWN: 'no such calculation in the design',
  DOCUMENT_STEP_UNKNOWN: 'no such step name',
  DOCUMENT_SIGNATURE_STEP_UNKNOWN: 'no such step name',
  DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE: 'that step is automatic: nobody signs it',
  DOCUMENT_IMAGE_UNKNOWN: 'not an image of the catalog',
  DOCUMENT_POSITION_UNKNOWN: 'not a position id of the catalog',
  DOCUMENT_APPROVAL_TYPE_UNKNOWN: 'not an approval type id of the catalog',
  EXPRESSION_INVALID: 'the placeholder text cannot be read',
};

export function describeFormatProblems(problems: readonly PdfProblem[]): string[] {
  return problems.slice(0, 30).map((problem) => `${problem.path}: ${problem.code}${PROBLEM_HINTS[problem.code] === undefined ? '' : ` (${PROBLEM_HINTS[problem.code]})`}${problem.detail === undefined ? '' : ` — ${problem.detail}`}`);
}

/**
 * Asks the model for a PDF format (new, or the one on screen with a change) and corrects it round by round, as the
 * workflow designer does: each answer is completed with the defaults a model leaves out, parsed with the canvas schema
 * and checked against the workflow like a format saved by hand; its problems go back in the next round. It keeps the
 * answer with the fewest errors and stops early at one without any. Pure orchestration: the caller owns the lease, the
 * ledger and what is done with the format.
 */
export class FormatDesigner {
  constructor(
    private readonly provider: LlmProvider,
    private readonly maxRounds: number,
  ) {}

  async design(task: FormatTask, catalog: FormatCatalog, check: (design: PdfCanvasDesign) => FormatCheck, hooks: Omit<DesignHooks, 'onPreview'>, signal: AbortSignal): Promise<FormatDesignResult> {
    const tool = { name: FORMAT_TOOL_NAME, description: FORMAT_TOOL_DESCRIPTION, schema: buildFormatToolSchema() };
    let correction: FormatCorrection | undefined;
    let best: Candidate | undefined;
    let answered = false;
    let corrections = 0;
    for (let round = 1; round <= this.maxRounds; round += 1) {
      if (signal.aborted || !(await hooks.beforeRound(round))) return { kind: 'interrupted' };
      let result: LlmResult;
      try {
        result = await this.provider.complete({ ...buildFormatPrompt(task, catalog, correction), images: task.images, tool }, signal);
      } catch (error) {
        if (!(error instanceof LlmCallError)) throw error;
        await hooks.afterCall({ round, outcome: FAILURE_OUTCOME[error.kind], usage: NO_USAGE, durationMs: error.durationMs, errorCode: error.status === undefined ? error.kind : `HTTP_${error.status}` });
        if (error.kind === 'NOT_CONFIGURED') return { kind: 'failed', errorCode: 'AI_NOT_CONFIGURED' };
        if (error.kind === 'ABORTED') return { kind: 'interrupted' };
        continue;
      }
      answered = true;
      const evaluation = evaluate(result, check);
      await hooks.afterCall({ round, outcome: evaluation.outcome, usage: result.usage, durationMs: result.durationMs, errorCode: null, ...(result.delivery === undefined ? {} : { delivery: result.delivery }) });
      if (evaluation.candidate !== undefined && (best === undefined || evaluation.candidate.errors <= best.errors)) best = evaluation.candidate;
      if (best !== undefined && best.errors === 0) return { kind: 'format', ...best, rounds: round, corrections };
      correction = evaluation.correction;
      corrections += correction.problems.length;
      if (round < this.maxRounds && !(await hooks.afterReview(round, correction.problems.length))) return { kind: 'interrupted' };
    }
    if (best !== undefined) return { kind: 'format', ...best, rounds: this.maxRounds, corrections };
    return { kind: 'failed', errorCode: answered ? 'AI_DRAFT_INVALID' : 'AI_PROVIDER_FAILED' };
  }
}

function evaluate(result: LlmResult, check: (design: PdfCanvasDesign) => FormatCheck): { outcome: CallOutcome; candidate?: Candidate; correction: FormatCorrection } {
  if (result.answer.kind === 'no_tool_call') return { outcome: 'TOOL_NOT_CALLED', correction: { previous: null, problems: [TOOL_NOT_CALLED_PROBLEM] } };
  const parsed = formatDraftSpecSchema.safeParse(completeFormatAnswer(result.answer.arguments));
  if (!parsed.success) {
    return { outcome: 'INVALID_OUTPUT', correction: { previous: result.answer.arguments, problems: parsed.error.issues.slice(0, 30).map((issue) => `${issue.path.join('.') || 'format'}: ${issue.message}`) } };
  }
  const checked = check(parsed.data.design);
  return {
    outcome: 'OK',
    candidate: { spec: parsed.data, errors: checked.errors.length, warnings: checked.warnings.length },
    correction: { previous: parsed.data, problems: describeFormatProblems([...checked.errors, ...checked.warnings]) },
  };
}
