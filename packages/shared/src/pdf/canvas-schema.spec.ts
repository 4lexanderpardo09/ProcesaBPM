import { describe, expect, it } from 'vitest';
import { field, step, version } from '../workflow/test-builders.js';
import { compileCanvasFormulas } from './canvas-formulas.js';
import { anyPdfDesignSchema, type CanvasElement, canvasSheetSize, defaultCanvasStyle, emptyCanvasDesign, type PdfCanvasDesign, pdfCanvasDesignSchema } from './canvas-schema.js';
import { emptyDesign } from './design-schema.js';
import { validateDesign } from './validate-pdf-sources.js';

const doc = version({
  steps: [step('s1', 'START'), step('Revisión', 'TASK'), step('auto', 'CONDITION'), step('end', 'END')],
  fields: [
    field('f1', 's1', 'NAME'),
    field('f2', 's1', 'AMOUNT', { type: 'CURRENCY' }),
    field('f3', 's1', 'ITEMS', { type: 'TABLE', config: { columns: [{ code: 'QTY', type: 'NUMBER', label: 'Cantidad' }, { code: 'ITEM', type: 'TEXT', label: 'Ítem' }] } }),
  ],
});

const at = { x: 10, y: 10, width: 50, height: 8, repeat: false, locked: false, sheet: 0, condition: '', style: defaultCanvasStyle() };
const text = (id: string, content: string, extra: Partial<CanvasElement> = {}): CanvasElement => ({ ...at, id, name: id, type: 'text', content, grow: false, ...extra }) as CanvasElement;
const table = (columns: Array<{ value: string; sum?: boolean }>, fieldCode = 'ITEMS'): CanvasElement => ({
  ...at,
  id: 'table',
  name: 'Tabla',
  type: 'table',
  fieldCode,
  columns: columns.map((column) => ({ header: 'h', value: column.value, align: 'LEFT', weight: 1, sum: column.sum ?? false })),
  showHeader: true,
  headerStyle: defaultCanvasStyle(),
  zebra: null,
  showTotals: true,
  totalLabel: 'Total',
  minRows: 0,
  emptyMessage: 'Sin filas',
});
const canvas = (elements: CanvasElement[], extra: Partial<PdfCanvasDesign> = {}): PdfCanvasDesign => ({ ...emptyCanvasDesign(), elements, ...extra });
const codes = (problems: ReturnType<typeof validateDesign>) => problems.map((problem) => `${problem.code}@${problem.path}`);

describe('pdfCanvasDesignSchema', () => {
  it('accepts the new canvas, and both versions go through the shared schema', () => {
    expect(pdfCanvasDesignSchema.safeParse(emptyCanvasDesign()).success).toBe(true);
    expect(anyPdfDesignSchema.safeParse(emptyCanvasDesign()).success).toBe(true);
    expect(anyPdfDesignSchema.safeParse(emptyDesign()).success).toBe(true);
  });

  it('rejects repeated ids and codes, an element on a missing sheet and a step signature without its step', () => {
    const issues = (design: unknown) => (pdfCanvasDesignSchema.safeParse(design).error?.issues ?? []).map((issue) => issue.path.join('.'));
    expect(issues(canvas([text('a', 'x'), text('a', 'y')]))).toEqual(['elements.1.id']);
    expect(issues(canvas([text('a', 'x', { sheet: 1 })]))).toEqual(['elements.0.sheet']);
    const calculation = { code: 'TOTAL', name: 'Total', formula: '1', decimals: 0 };
    expect(issues(canvas([], { calculations: [calculation, calculation] }))).toEqual(['calculations.1.code']);
    const signature = { ...at, id: 's', name: 's', type: 'signature', source: 'STEP', stepName: null, signers: 'LAST', position: 1, label: '', showName: true, showDate: true, showLine: true };
    expect(issues(canvas([signature as CanvasElement]))).toEqual(['elements.0.stepName']);
  });

  it('checks the placeholders of texts when saved', () => {
    expect(pdfCanvasDesignSchema.safeParse(canvas([text('a', '{{constructor}}')])).success).toBe(false);
    expect(pdfCanvasDesignSchema.safeParse(canvas([text('a', '{{calc.TOTAL|currency}} de {{page}}')])).success).toBe(true);
  });

  it('turns the sheet for landscape', () => {
    expect(canvasSheetSize({ size: 'LETTER', orientation: 'LANDSCAPE', marginBottom: 10 })).toEqual({ width: 279.4, height: 215.9 });
  });
});

describe('compileCanvasFormulas', () => {
  it('compiles calculations in order: each one reads the fields and the calculations above it', () => {
    const compiled = compileCanvasFormulas(
      canvas([], {
        calculations: [
          { code: 'SUBTOTAL', name: 'Subtotal', formula: 'SUM(ITEMS.QTY) * 2', decimals: 0 },
          { code: 'WITH_TAX', name: 'Con IVA', formula: 'SUBTOTAL * 1.19', decimals: 2 },
          { code: 'EARLY', name: 'Usa uno de abajo', formula: 'LATE + 1', decimals: 0 },
          { code: 'LATE', name: 'Tarde', formula: '1', decimals: 0 },
        ],
      }),
      doc.fields,
    );
    expect(compiled.calculations.map((calculation) => calculation.code)).toEqual(['SUBTOTAL', 'WITH_TAX', 'LATE']);
    expect(compiled.problems.map((problem) => problem.path)).toEqual(['calculations[2].formula']);
  });

  it('wants true or false from a condition, and a calculation that is not a yes or no', () => {
    const compiled = compileCanvasFormulas(
      canvas([text('a', 'x', { condition: 'AMOUNT > 100' }), text('b', 'x', { condition: 'AMOUNT + 1' })], {
        calculations: [{ code: 'FLAG', name: 'Bandera', formula: 'AMOUNT > 1', decimals: 0 }],
        sheets: [{ name: '', condition: 'NAME = "x"' }],
      }),
      doc.fields,
    );
    expect([...compiled.elementConditions.keys()]).toEqual(['a']);
    expect([...compiled.sheetConditions.keys()]).toEqual([0]);
    expect(compiled.problems.map((problem) => problem.path)).toEqual(['calculations[0].formula', 'elements[1].condition']);
  });

  it('refuses a calculation named like a field', () => {
    expect(compileCanvasFormulas(canvas([], { calculations: [{ code: 'AMOUNT', name: 'x', formula: '1', decimals: 0 }] }), doc.fields).problems.map((problem) => problem.code)).toEqual(['DOCUMENT_CALCULATION_CODE_TAKEN']);
  });
});

describe('validateDesign of a canvas', () => {
  it('passes a canvas that only names what the version and its calculations have', () => {
    const ok = canvas(
      [
        text('a', '{{field.NAME}} {{calc.TOTAL|currency}} {{step.Revisión.completedBy}} {{page}}/{{pages}}'),
        table([{ value: '{{row.QTY|number:0}}', sum: true }, { value: '{{row.ITEM}}' }]),
        { ...at, id: 's', name: 's', type: 'signature', source: 'STEP', stepName: 'Revisión', signers: 'ALL', position: 1, label: 'Revisó', showName: true, showDate: true, showLine: true },
      ],
      { calculations: [{ code: 'TOTAL', name: 'Total', formula: 'AMOUNT * 2', decimals: 2 }] },
    );
    expect(validateDesign(ok, doc)).toEqual([]);
  });

  it('names each unknown field, column, calculation, table and signing step, and each bad formula', () => {
    const bad = canvas(
      [
        text('a', '{{field.NOPE}} {{calc.MISSING}} {{row.QTY}}', { condition: 'NOPE > 1' }),
        table([{ value: '{{row.NOPE}}' }], 'NAME'),
        { ...at, id: 's', name: 's', type: 'signature', source: 'STEP', stepName: 'auto', signers: 'LAST', position: 1, label: '', showName: true, showDate: true, showLine: true },
      ],
      { calculations: [{ code: 'TOTAL', name: 'Total', formula: 'AMOUNT +', decimals: 2 }] },
    );
    expect(codes(validateDesign(bad, doc))).toEqual([
      'DOCUMENT_FORMULA_INVALID@calculations[0].formula',
      'DOCUMENT_FORMULA_INVALID@elements[0].condition',
      'DOCUMENT_FIELD_UNKNOWN@elements[0].content',
      'DOCUMENT_CALCULATION_UNKNOWN@elements[0].content',
      'DOCUMENT_ROW_OUTSIDE_TABLE@elements[0].content',
      'DOCUMENT_FIELD_TYPE_MISMATCH@elements[1].fieldCode',
      'DOCUMENT_ROW_OUTSIDE_TABLE@elements[1].columns[0].value',
      'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE@elements[2].stepName',
    ]);
  });

  it('an uploaded image says which one, and must be one of the workflow’s when the caller knows them', () => {
    const image = (extra: Record<string, unknown>) => ({ ...at, id: 'img', name: 'img', type: 'image', fit: 'CONTAIN', ...extra }) as CanvasElement;
    const known = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
    const other = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';
    expect(pdfCanvasDesignSchema.safeParse(canvas([image({ source: 'UPLOADED' })])).success).toBe(false);
    expect(pdfCanvasDesignSchema.safeParse(canvas([image({ source: 'TENANT_LOGO' })])).success).toBe(true);
    const design = canvas([image({ source: 'UPLOADED', imageId: known }), image({ id: 'img2', name: 'img2', source: 'UPLOADED', imageId: other })]);
    expect(pdfCanvasDesignSchema.safeParse(design).success).toBe(true);
    expect(codes(validateDesign(design, doc, { imageIds: new Set([known]) }))).toEqual(['DOCUMENT_IMAGE_UNKNOWN@elements[1].imageId']);
    expect(validateDesign(design, doc)).toEqual([]);
  });

  it('a block document cannot read a calculation', () => {
    expect(codes(validateDesign({ ...emptyDesign(), body: [{ type: 'text', text: '{{calc.TOTAL}}' }] }, doc))).toEqual(['DOCUMENT_CALCULATION_UNKNOWN@body[0].text']);
  });
});
