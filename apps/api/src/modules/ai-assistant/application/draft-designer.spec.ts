import type { WorkflowDraftSpec } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { advanceSpec, catalog } from '../../../../../../packages/shared/src/workflow/draft-spec/test-fixtures.js';
import { LlmCallError, LlmProvider, type LlmRequest, type LlmResult } from '../../../infrastructure/llm/llm-provider.js';
import { type CallRecord, DraftDesigner } from './draft-designer.js';

const USAGE = { promptTokens: 3000, cachedPromptTokens: 0, completionTokens: 8000, reasoningTokens: 6000 };
type Step = LlmResult['answer'] | LlmCallError;

class ScriptedProvider extends LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly requests: LlmRequest[] = [];

  constructor(private readonly script: Step[]) {
    super();
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const step = this.script.shift();
    if (step === undefined) throw new Error('no more scripted answers');
    if (step instanceof LlmCallError) throw step;
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

async function run(script: Step[], options: { maxRounds?: number; renew?: () => Promise<boolean>; signal?: AbortSignal } = {}) {
  const provider = new ScriptedProvider(script);
  const calls: CallRecord[] = [];
  const result = await new DraftDesigner(provider, options.maxRounds ?? 3).design(
    'El asesor pide un anticipo.',
    catalog,
    { beforeRound: options.renew ?? (() => Promise.resolve(true)), afterCall: (call) => Promise.resolve(void calls.push(call)) },
    options.signal ?? new AbortController().signal,
  );
  return { result, calls, provider };
}

describe('DraftDesigner', () => {
  it('returns the first draft that has no problems, recording the call', async () => {
    const { result, calls, provider } = await run([tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 1, errors: 0, assumptions: advanceSpec().assumptions });
    expect(calls).toEqual([{ round: 1, outcome: 'OK', usage: USAGE, durationMs: 1000, errorCode: null }]);
    expect(provider.requests[0]!.tool.name).toBe('submit_workflow_draft');
  });

  it('sends the problems back and keeps the corrected draft', async () => {
    const { result, calls, provider } = await run([tool(withoutPaymentExit()), tool(advanceSpec())]);
    expect(result).toMatchObject({ kind: 'draft', rounds: 2, errors: 0 });
    expect(calls.map((call) => call.outcome)).toEqual(['OK', 'OK']);
    expect(provider.requests[1]!.user).toContain('PEOPLE_BLOCK_WITHOUT_DECISION at step "pago"');
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
});
