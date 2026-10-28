import { describe, expect, it } from 'vitest';
import { DRAFT_PREVIEW_LIMITS, draftPreviewOf, parsePartialJson } from './draft-preview.js';
import { advanceSpec } from './test-fixtures.js';

describe('parsePartialJson', () => {
  it('reads whole JSON as JSON.parse does', () => {
    const text = JSON.stringify({ a: [1, 2.5, -3e2, true, false, null, 'x "y" \\ z'], b: { c: [] }, d: '' }, null, 2);
    expect(parsePartialJson(text)).toEqual(JSON.parse(text));
  });

  it.each([
    ['', undefined],
    ['{', {}],
    ['{"steps": [', { steps: [] }],
    ['{"steps": [{"ref": "inicio", "na', { steps: [{ ref: 'inicio' }] }],
    ['{"steps": [{"ref": "inicio", "name": "Solic', { steps: [{ ref: 'inicio' }] }],
    ['{"steps": [{"ref": "inicio"}, {"ref": "jefe"', { steps: [{ ref: 'inicio' }, { ref: 'jefe' }] }],
    ['{"n": 12', {}],
    ['{"n": 12,', { n: 12 }],
    ['{"n": tru', {}],
    ['{"a": "x\\"', {}],
    ['{"a": [1, [2, [3', { a: [1, [2, []]] }],
  ])('keeps what is finished of %j', (text, expected) => {
    expect(parsePartialJson(text)).toEqual(expected);
  });

  it('refuses text that can never become JSON', () => {
    expect(() => parsePartialJson('{"a" 1')).toThrow(SyntaxError);
    expect(() => parsePartialJson('[1 2')).toThrow(SyntaxError);
  });
});

describe('draftPreviewOf', () => {
  const text = JSON.stringify(advanceSpec());

  it('grows with the text: every prefix gives a preview, and the whole text gives every block and connection', () => {
    let previous = 0;
    for (let end = 0; end <= text.length; end += 97) {
      const preview = draftPreviewOf(text.slice(0, end));
      const size = preview.steps.length + preview.transitions.length;
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
    const whole = draftPreviewOf(text);
    expect(whole.steps).toEqual(advanceSpec().steps.map(({ ref, type, name }) => ({ ref, type, name })));
    expect(whole.transitions).toEqual(advanceSpec().transitions.map(({ from, to, label }) => ({ from, to, label })));
  });

  it('shows a block only once its name is written, and a connection only between blocks it shows', () => {
    const cut = text.slice(0, text.indexOf('"name":"Aprobación del jefe"') + '"name":"Aprob'.length);
    expect(draftPreviewOf(cut).steps.map((step) => step.name)).toEqual(['Solicitud de anticipo']);
    const dangling = JSON.stringify({ steps: [{ ref: 'a', type: 'START', name: 'A' }], transitions: [{ from: 'a', to: 'b', label: 'Ir' }] });
    expect(draftPreviewOf(dangling).transitions).toEqual([]);
  });

  it('leaves out what is not a block of the spec, repeats and anything past its limits', () => {
    const steps = [
      { ref: 'a', type: 'START', name: 'A' },
      { ref: 'a', type: 'TASK', name: 'Otra A' },
      { ref: 'b', type: 'DOCUMENT', name: 'B' },
      { ref: 'c', type: 'TASK', name: ' ' },
      ...Array.from({ length: 80 }, (_, index) => ({ ref: `s${index}`, type: 'TASK', name: 'x'.repeat(500) })),
    ];
    const preview = draftPreviewOf(JSON.stringify({ steps, transitions: [] }));
    expect(preview.steps).toHaveLength(DRAFT_PREVIEW_LIMITS.steps);
    expect(preview.steps.slice(0, 2).map((step) => step.ref)).toEqual(['a', 's0']);
    expect(preview.steps[1]!.name).toHaveLength(DRAFT_PREVIEW_LIMITS.text);
    expect(new TextEncoder().encode(JSON.stringify(preview)).length).toBeLessThan(64 * 1024);
  });

  it('gives an empty preview for text that is not a draft', () => {
    expect(draftPreviewOf('Lo siento')).toEqual({ steps: [], transitions: [] });
    expect(draftPreviewOf('[1, 2')).toEqual({ steps: [], transitions: [] });
  });
});
