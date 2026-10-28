import type { DraftPreview, WorkflowDraftSpec } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { advanceSpec, basisOf, catalog, stored, translated } from '../../../../../../packages/shared/src/workflow/draft-spec/test-fixtures.js';
import { LlmCallError, LlmProvider, type LlmRequest, type LlmResult, type ToolArgumentsListener } from '../../../infrastructure/llm/llm-provider.js';
import type { DraftTask } from '../domain/prompt-builder.js';
import { type CallRecord, DraftDesigner, PREVIEW_INTERVAL_MS } from './draft-designer.js';

const USAGE = { promptTokens: 3000, cachedPromptTokens: 0, completionTokens: 8000, reasoningTokens: 6000 };
/** The fake clock: each streamed piece of a scripted answer takes STREAM_STEP_MS. */
let clock = 0;
const STREAM_STEP_MS = 400;
const STREAM_PIECE = 60;
type Step = LlmResult['answer'] | LlmCallError;

class ScriptedProvider extends LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: Step[]) {
    super();
  }

  async complete(request: LlmRequest, _signal: AbortSignal, onArguments?: ToolArgumentsListener): Promise<LlmResult> {
    this.requests.push(request);
    const step = this.script.shift();
    if (step === undefined) throw new Error('no more scripted answers');
    if (step instanceof LlmCallError) throw step;
    if (step.kind === 'tool_call' && onArguments !== undefined) {
      const text = JSON.stringify(step.arguments);
      for (let end = STREAM_PIECE; end < text.length + STREAM_PIECE; end += STREAM_PIECE) {
        clock += STREAM_STEP_MS;
        onArguments(text.slice(0, end));
      }
    }
    return { answer: step, usage: USAGE, durationMs: 1000 };
  }
}

const tool = (spec: unknown): Step => ({ kind: 'tool_call', arguments: spec });
/** The advance request with the treasurer's step left without a way out: translatable, but not publishable. */
function withoutPaymentExit(): WorkflowDraftSpec {
  const spec = advanceSpec();
  return { ...spec, transitions: spec.transitions.filter((transition) => transition.from !== 'pago') };
}
/** A START that leaves through a decision: the database would refuse it, so it is never kept. */
function withBlockingProblem(): WorkflowDraftSpec {
  const spec = advanceSpec();
  return { ...spec, steps: spec.steps.map((step) => (step.ref === 'jefe' ? { ...step, name: 'Revisión contable' } : step)) };
}

interface RunOptions {
  maxRounds?: number;
  renew?: (round: number) => Promise<boolean>;
  review?: (round: number, problems: number) => Promise<boolean>;
  signal?: AbortSignal;
  task?: DraftTask;
}

async function run(script: Step[], options: RunOptions = {}) {
  const provider = new ScriptedProvider(script);
  const calls: CallRecord[] = [];
  const stages: string[] = [];
  const previews: Array<{ round: number; preview: DraftPreview; at: number }> = [];
  const result = await new DraftDesigner(provider, options.maxRounds ?? 3, () => clock).design(
    options.task ?? { kind: 'create', description: 'El asesor pide un anticipo.' },
    catalog,
    {
      beforeRound: (round) => {
        stages.push(`DESIGNING ${round}`);
        return options.renew?.(round) ?? Promise.resolve(true);
      },
      afterReview: (round, problems) => {
        stages.push(`REVIEWING ${round} ${problems}`);
        return options.review?.(round, problems) ?? Promise.resolve(true);
      },
      afterCall: (call) => Promise.resolve(void calls.push(call)),
      onPreview: (round, preview) => previews.push({ round, preview, at: clock }),
    },
    options.signal ?? new AbortController().signal,
  );
  return { result, calls, provider, stages, previews };
}

describe('DraftDesigner', () => {
  it('returns the first draft that has no problems, recording the call', async () => {
    const { result, calls, provider } = await run([tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 1, corrections: 0, errors: 0, summary: { assumptions: advanceSpec().assumptions, decisions: advanceSpec().decisions } });
    expect(calls).toEqual([{ round: 1, outcome: 'OK', usage: USAGE, durationMs: 1000, errorCode: null }]);
    expect(provider.requests[0]!.tool.name).toBe('submit_workflow_draft');
  });

  it('counts what the draft holds without trusting the model', async () => {
    const spec = advanceSpec();
    const { result } = await run([tool(spec)]);
    expect((result as { summary: { outline: unknown } }).summary.outline).toEqual({
      steps: spec.steps.filter((step) => step.type !== 'START' && step.type !== 'END').length,
      approvals: spec.steps.filter((step) => step.type === 'APPROVAL').length,
      fields: spec.fields.length,
      initiators: spec.initiators.length,
      amountRules: spec.amountRules.length,
    });
  });

  it('sends the problems back and keeps the corrected draft', async () => {
    const { result, calls, provider, stages } = await run([tool(withoutPaymentExit()), tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 2, errors: 0 });
    expect((result as { corrections: number }).corrections).toBe(Number(stages[1]!.split(' ')[2]));
    expect(calls.map((call) => call.outcome)).toEqual(['OK', 'OK']);
    expect(provider.requests[1]!.user).toContain('PEOPLE_BLOCK_WITHOUT_DECISION at step "pago"');
  });

  it('reports each round and the problems found before the next one; none after the last round or a clean draft', async () => {
    expect((await run([tool(withoutPaymentExit()), tool(advanceSpec())])).stages).toEqual(['DESIGNING 1', expect.stringMatching(/^REVIEWING 1 [1-9]\d*$/), 'DESIGNING 2']);
    expect((await run([tool(withoutPaymentExit()), tool(withoutPaymentExit())], { maxRounds: 2 })).stages).toEqual(['DESIGNING 1', expect.stringMatching(/^REVIEWING 1 /), 'DESIGNING 2']);
    expect((await run([tool(advanceSpec())])).stages).toEqual(['DESIGNING 1']);
  });

  it('stops when the request was cancelled while its answer was being checked', async () => {
    const { result, calls } = await run([tool(withoutPaymentExit()), tool(advanceSpec())], { review: () => Promise.resolve(false) });
    expect(result).toEqual({ kind: 'interrupted' });
    expect(calls).toHaveLength(1);
  });

  it('asks again when the model answers without the tool or with an invalid shape', async () => {
    const { result, calls, provider } = await run([{ kind: 'no_tool_call' }, tool({ steps: 'nope' }), tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 3 });
    expect(calls.map((call) => call.outcome)).toEqual(['TOOL_NOT_CALLED', 'INVALID_OUTPUT', 'OK']);
    expect(provider.requests[1]!.user).toContain('You answered without calling the tool');
    expect(provider.requests[2]!.user).toMatch(/steps: /);
  });

  it('keeps the last draft the database accepts when the rounds run out, with its problems for the person', async () => {
    const { result } = await run([tool(withoutPaymentExit()), tool(withBlockingProblem()), tool(withoutPaymentExit())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 3 });
    expect((result as { errors: number }).errors).toBeGreaterThan(0);
  });

  it('fails AI_DRAFT_INVALID when no answer could be written', async () => {
    const { result } = await run([tool(withBlockingProblem()), { kind: 'no_tool_call' }], { maxRounds: 2 });
    expect(result).toEqual({ kind: 'failed', errorCode: 'AI_DRAFT_INVALID' });
  });

  it('records the provider failures as calls and fails AI_PROVIDER_FAILED when none answered', async () => {
    const { result, calls } = await run([new LlmCallError('RATE_LIMITED', 50, 429), new LlmCallError('TIMEOUT', 300_000)], { maxRounds: 2 });
    expect(result).toEqual({ kind: 'failed', errorCode: 'AI_PROVIDER_FAILED' });
    expect(calls.map((call) => [call.outcome, call.errorCode, call.usage.promptTokens])).toEqual([
      ['RATE_LIMITED', 'HTTP_429', 0],
      ['TIMEOUT', 'TIMEOUT', 0],
    ]);
  });

  it('stops at once without a key, when the lease is lost and when the worker stops', async () => {
    expect((await run([new LlmCallError('NOT_CONFIGURED', 0)])).result).toEqual({ kind: 'failed', errorCode: 'AI_NOT_CONFIGURED' });
    const lost = await run([tool(advanceSpec())], { renew: () => Promise.resolve(false) });
    expect(lost.result).toEqual({ kind: 'interrupted' });
    expect(lost.calls).toEqual([]);
    expect((await run([new LlmCallError('ABORTED', 10)])).result).toEqual({ kind: 'interrupted' });
    const stopped = new AbortController();
    stopped.abort();
    expect((await run([tool(advanceSpec())], { signal: stopped.signal })).result).toEqual({ kind: 'interrupted' });
  });

  it('revises the current draft: sends it with the change, and keeps only the changes the model reports', async () => {
    const basis = basisOf(stored(translated(advanceSpec())));
    const current = basis.spec;
    const revised = { ...current, decisions: [{ topic: 'STEPS' as const, text: 'Agregué la revisión jurídica después de gerencia.' }] };
    const task: DraftTask = { kind: 'revise', message: 'agrega una revisión jurídica', basis, history: [] };
    const { result, provider } = await run([tool(withoutPaymentExit()), tool(revised)], { task });
    expect(result).toMatchObject({ kind: 'draft', rounds: 2, summary: { decisions: revised.decisions } });
    for (const request of provider.requests) {
      expect(request.user).toContain(`<current_draft>\n${JSON.stringify(current)}\n</current_draft>`);
      expect(request.user).toContain('<change_request>\nagrega una revisión jurídica\n</change_request>');
    }
    expect(provider.requests[1]!.user).toContain('PEOPLE_BLOCK_WITHOUT_DECISION at step "pago"');
  });

  it('puts back the settings the model cannot see on what it left alone, and says which were kept and which lost', async () => {
    const doc = stored(translated(advanceSpec()));
    const tuned = {
      ...doc,
      steps: doc.steps.map((step) => (step.name === 'Pago del anticipo' ? { ...step, closeRule: 'ALLOWED' as const } : step.name === 'Revisión contable' ? { ...step, allowsBatch: true } : step)),
    };
    const basis = basisOf(tuned);
    const revised = { ...basis.spec, steps: basis.spec.steps.map((step) => (step.name === 'Revisión contable' ? { ...step, instructions: 'Revisa también el monto.' } : step)) };
    const { result } = await run([tool(revised)], { task: { kind: 'revise', message: 'que revise el monto', basis, history: [] } });
    if (result.kind !== 'draft') throw new Error(result.kind);
    expect(result.rounds).toBe(1);
    expect(result.document.steps.find((step) => step.name === 'Pago del anticipo')?.closeRule).toBe('ALLOWED');
    expect(result.document.steps.find((step) => step.name === 'Revisión contable')?.allowsBatch).toBe(false);
    expect(result.summary.keptSettings).toEqual([{ subject: 'STEP', name: 'Pago del anticipo', properties: ['closeRule'] }]);
    expect(result.summary.droppedSettings).toEqual([{ subject: 'STEP', name: 'Revisión contable', properties: ['allowsBatch'] }]);
  });

  it('shows the diagram growing while each round streams: never more often than the interval, never smaller', async () => {
    const { result, previews } = await run([tool(withoutPaymentExit()), tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 2 });
    expect(previews.length).toBeGreaterThan(2);
    for (const round of [1, 2]) {
      const shown = previews.filter((entry) => entry.round === round);
      expect(shown.length).toBeGreaterThan(0);
      shown.slice(1).forEach((entry, index) => {
        expect(entry.at - shown[index]!.at).toBeGreaterThanOrEqual(PREVIEW_INTERVAL_MS);
        const size = (preview: DraftPreview) => preview.steps.length + preview.transitions.length;
        expect(size(entry.preview)).toBeGreaterThan(size(shown[index]!.preview));
      });
    }
    expect(previews.at(-1)!.preview.steps.map((step) => step.ref)).toEqual(expect.arrayContaining(['inicio', 'jefe']));
  });
});
