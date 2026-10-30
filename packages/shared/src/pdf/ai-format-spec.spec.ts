import { describe, expect, it } from 'vitest';
import { buildFormatToolSchema, completeFormatAnswer, formatDraftSpecSchema } from './ai-format-spec.js';
import { defaultCanvasStyle } from './canvas-schema.js';

const answer = (elements: unknown[], extra: Record<string, unknown> = {}) => ({ design: { page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, elements, ...extra } });

describe('formatDraftSpecSchema and completeFormatAnswer', () => {
  it('fills what a model leaves out of an element (defaults, style, ids, sheets) so a lean answer is a valid canvas', () => {
    const lean = answer([
      { type: 'text', x: 15, y: 15, width: 100, height: 8, content: '{{ticket.title}}', grow: false, style: { size: 16, bold: true } },
      { id: 'tabla', type: 'table', x: 15, y: 40, width: 185, height: 20, fieldCode: 'ITEMS', columns: [{ header: 'Valor', value: '{{row.VALOR|currency}}', align: 'RIGHT', weight: 2, sum: true }], showHeader: true, zebra: null, showTotals: true, totalLabel: 'Total', minRows: 0, emptyMessage: 'Sin registros' },
      { id: 'tabla', type: 'line', x: 15, y: 30, width: 185, height: 0.5, orientation: 'HORIZONTAL', thickness: 0.5, color: '#111827', dash: 'SOLID' },
    ]);
    const parsed = formatDraftSpecSchema.parse(completeFormatAnswer(lean));
    expect(parsed.design.version).toBe(2);
    expect(parsed.design.sheets).toEqual([{ name: '', condition: '' }]);
    expect(parsed.design.elements.map((element) => element.id)).toEqual(['e1', 'tabla', 'e3']);
    expect(parsed.design.elements[0]!.style).toEqual({ ...defaultCanvasStyle(), size: 16, bold: true });
    expect(parsed.design.elements[1]).toMatchObject({ repeat: false, locked: false, sheet: 0, condition: '', headerStyle: defaultCanvasStyle() });
    expect(parsed.assumptions).toEqual([]);
  });

  it('still refuses what is wrong rather than guessing (unknown element type, bad colour)', () => {
    expect(formatDraftSpecSchema.safeParse(completeFormatAnswer(answer([{ type: 'barcode', x: 1, y: 1, width: 10, height: 10 }]))).success).toBe(false);
    expect(formatDraftSpecSchema.safeParse(completeFormatAnswer(answer([{ type: 'rectangle', x: 1, y: 1, width: 10, height: 10, style: { color: 'red' } }]))).success).toBe(false);
    expect(completeFormatAnswer('not an object')).toBe('not an object');
  });

  it('gives the model a JSON Schema of the whole answer, without the $schema key', () => {
    const schema = buildFormatToolSchema();
    expect(schema).not.toHaveProperty('$schema');
    expect(schema).toMatchObject({ type: 'object', required: ['design', 'assumptions', 'decisions'] });
    expect(JSON.stringify(schema)).toContain('"signature"');
  });
});
