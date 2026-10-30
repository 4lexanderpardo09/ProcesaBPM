import { type PdfCanvasDesign, type PdfProblem } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { LlmCallError, type LlmProvider, type LlmRequest, type LlmResult } from '../../../infrastructure/llm/llm-provider.js';
import type { FormatCatalog } from '../domain/format-prompt.js';
import { describeFormatProblems, FormatDesigner } from './format-designer.js';

const catalog: FormatCatalog = { workflowName: 'Compras', fields: [{ code: 'TOTAL', label: 'Total', type: 'CURRENCY', columns: [] }], steps: [{ name: 'Aprobación', type: 'APPROVAL' }], images: [], positions: [], approvalTypes: [] };
const usage = { promptTokens: 100, cachedPromptTokens: 0, completionTokens: 50, reasoningTokens: 0 };
const text = (content: string) => ({ type: 'text', x: 15, y: 15, width: 100, height: 8, content, grow: false });
const answer = (content: string): LlmResult => ({ answer: { kind: 'tool_call', arguments: { design: { page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, elements: [text(content)] }, assumptions: ['Supuse carta.'], decisions: [{ topic: 'LAYOUT', text: 'Un título arriba.' }] } }, usage, durationMs: 10 });

/** Answers each round with the next scripted result (or failure), and keeps the requests it got. */
function scripted(...rounds: Array<LlmResult | LlmCallError>): { provider: LlmProvider; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const provider = {
    name: 'fake',
    model: 'fake-1',
    complete: (request: LlmRequest) => {
      requests.push(request);
      const next = rounds.shift();
      return next instanceof LlmCallError || next === undefined ? Promise.reject(next ?? new LlmCallError('PROVIDER_ERROR', 1)) : Promise.resolve(next);
    },
  } as LlmProvider;
  return { provider, requests };
}

/** A field the catalog lacks is an error, as the save would say. */
const check = (design: PdfCanvasDesign) => {
  const errors: PdfProblem[] = design.elements.flatMap((element, index) => (element.type === 'text' && element.content.includes('field.NOPE') ? [{ code: 'DOCUMENT_FIELD_UNKNOWN' as const, path: `elements[${index}].content`, detail: 'NOPE' }] : []));
  return { errors, warnings: [] };
};
const hooks = (calls: string[]) => ({ beforeRound: async () => true, afterReview: async () => true, afterCall: async (call: { outcome: string }) => void calls.push(call.outcome) });

describe('FormatDesigner', () => {
  it('stops at the first format without errors, with the defaults filled in', async () => {
    const { provider, requests } = scripted(answer('{{field.TOTAL|currency}}'));
    const calls: string[] = [];
    const result = await new FormatDesigner(provider, 3).design({ kind: 'create', description: 'Un comprobante con el total' }, catalog, check, hooks(calls), new AbortController().signal);
    expect(result).toMatchObject({ kind: 'format', rounds: 1, corrections: 0, errors: 0 });
    expect(result.kind === 'format' && result.spec.design.elements[0]).toMatchObject({ id: 'e1', sheet: 0, style: { font: 'HELVETICA' } });
    expect(calls).toEqual(['OK']);
    expect(requests[0]!.tool.name).toBe('submit_pdf_format');
    expect(requests[0]!.user).toContain('TOTAL: Total (CURRENCY)');
    expect(requests[0]!.user).toContain('<description>');
  });

  it('sends the problems back, corrects them in the next round, and records every call', async () => {
    const { provider, requests } = scripted({ answer: { kind: 'no_tool_call' }, usage, durationMs: 5 }, answer('{{field.NOPE}}'), answer('{{field.TOTAL}}'));
    const calls: string[] = [];
    const result = await new FormatDesigner(provider, 3).design({ kind: 'create', description: 'Un comprobante con el total' }, catalog, check, hooks(calls), new AbortController().signal);
    expect(result).toMatchObject({ kind: 'format', rounds: 3, errors: 0 });
    expect(calls).toEqual(['TOOL_NOT_CALLED', 'OK', 'OK']);
    expect(requests[1]!.user).toContain('without calling the tool submit_pdf_format');
    expect(requests[2]!.user).toContain('DOCUMENT_FIELD_UNKNOWN (no such field in the catalog) — NOPE');
  });

  it('keeps the best format when the rounds run out, and fails only when nothing usable came back', async () => {
    const left = await new FormatDesigner(scripted(answer('{{field.NOPE}}'), answer('{{field.NOPE}}')).provider, 2).design({ kind: 'create', description: 'x'.repeat(20) }, catalog, check, hooks([]), new AbortController().signal);
    expect(left).toMatchObject({ kind: 'format', rounds: 2, errors: 1 });
    const invalid = await new FormatDesigner(scripted({ answer: { kind: 'tool_call', arguments: { design: 'nope' } }, usage, durationMs: 5 }).provider, 1).design({ kind: 'create', description: 'x'.repeat(20) }, catalog, check, hooks([]), new AbortController().signal);
    expect(invalid).toEqual({ kind: 'failed', errorCode: 'AI_DRAFT_INVALID' });
    const down = await new FormatDesigner(scripted(new LlmCallError('TIMEOUT', 5)).provider, 1).design({ kind: 'create', description: 'x'.repeat(20) }, catalog, check, hooks([]), new AbortController().signal);
    expect(down).toEqual({ kind: 'failed', errorCode: 'AI_PROVIDER_FAILED' });
    const off = await new FormatDesigner(scripted(new LlmCallError('NOT_CONFIGURED', 0)).provider, 3).design({ kind: 'create', description: 'x'.repeat(20) }, catalog, check, hooks([]), new AbortController().signal);
    expect(off).toEqual({ kind: 'failed', errorCode: 'AI_NOT_CONFIGURED' });
  });

  it('sends a change with the format on screen and the earlier requests, and stops when the request is no longer ours', async () => {
    const basis = { version: 2, page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, sheets: [{ name: '', condition: '' }], calculations: [], elements: [] } as PdfCanvasDesign;
    const { provider, requests } = scripted(answer('{{field.TOTAL}}'));
    await new FormatDesigner(provider, 3).design({ kind: 'revise', message: 'Agrega el total', basis, history: [{ message: 'Un comprobante', applied: true, decisions: [] }] }, catalog, check, hooks([]), new AbortController().signal);
    expect(requests[0]!.user).toContain('<current_format>');
    expect(requests[0]!.user).toContain('- (applied) Un comprobante');
    expect(requests[0]!.system).toContain('CHANGING THE FORMAT ON SCREEN');
    const stopped = await new FormatDesigner(scripted(answer('x')).provider, 3).design({ kind: 'create', description: 'x'.repeat(20) }, catalog, check, { ...hooks([]), beforeRound: async () => false }, new AbortController().signal);
    expect(stopped).toEqual({ kind: 'interrupted' });
  });

  it('describes problems with a hint the model can act on', () => {
    expect(describeFormatProblems([{ code: 'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE', path: 'elements[2].stepName', detail: 'Inicio' }])).toEqual(['elements[2].stepName: DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE (that step is automatic: nobody signs it) — Inicio']);
  });
});
