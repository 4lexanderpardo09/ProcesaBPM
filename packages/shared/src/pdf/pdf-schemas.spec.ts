import { describe, expect, it } from 'vitest';
import { field, step, version } from '../workflow/test-builders.js';
import { emptyDesign, pdfDesignSchema, type PdfDesign } from './design-schema.js';
import { templateMappingSchema, type PageBox } from './mapping-schema.js';
import { sampleRenderValue } from './sample-values.js';
import { validateDesign, validateMapping } from './validate-pdf-sources.js';

const doc = version({
  steps: [step('s1', 'START'), step('Revisión', 'TASK'), step('auto', 'CONDITION'), step('end', 'END')],
  fields: [
    field('f1', 's1', 'NAME'),
    field('f2', 's1', 'AMOUNT', { type: 'CURRENCY' }),
    field('f3', 's1', 'ITEMS', { type: 'TABLE', config: { columns: [{ code: 'QTY', type: 'NUMBER', label: 'Cantidad' }, { code: 'ITEM', type: 'TEXT', label: 'Ítem' }] } }),
    field('f4', 's1', 'KIND', { type: 'SELECT', config: { options: [{ value: 'a', label: 'Opción A' }] } }),
  ],
});
const design = (body: PdfDesign['body'], extra: Partial<PdfDesign> = {}): PdfDesign => ({ ...emptyDesign(), body, ...extra });
const codes = (problems: ReturnType<typeof validateDesign>) => problems.map((problem) => `${problem.code}@${problem.path}`);

describe('pdfDesignSchema', () => {
  it('accepts the default design', () => expect(pdfDesignSchema.safeParse(emptyDesign()).success).toBe(true));
  it('rejects unknown keys, blocks and bad expressions at save time', () => {
    expect(pdfDesignSchema.safeParse({ ...emptyDesign(), extra: 1 }).success).toBe(false);
    expect(pdfDesignSchema.safeParse(design([{ type: 'script' } as never])).success).toBe(false);
    const bad = pdfDesignSchema.safeParse(design([{ type: 'text', text: '{{constructor}}' }]));
    expect(bad.success).toBe(false);
  });
  it('caps the number of blocks and the table columns', () => {
    expect(pdfDesignSchema.safeParse(design(Array.from({ length: 201 }, () => ({ type: 'line' as const })))).success).toBe(false);
    const columns = Array.from({ length: 13 }, () => ({ header: 'h', value: '{{row.QTY}}', width: { fr: 1 } }));
    expect(pdfDesignSchema.safeParse(design([{ type: 'table', fieldCode: 'ITEMS', columns, repeatHeader: true }])).success).toBe(false);
  });
  it('page and pages are fine in the header and footer, checked by the source validator', () => {
    expect(pdfDesignSchema.safeParse(design([], { footer: { height: 20, blocks: [{ type: 'text', text: 'Página {{page}} de {{pages}}' }] } })).success).toBe(true);
  });
});

describe('validateDesign', () => {
  it('passes a design that only names what the version has', () => {
    const ok = design([
      { type: 'text', text: '{{field.NAME}} {{ticket.number}} {{step.Revisión.completedBy}}' },
      { type: 'table', fieldCode: 'ITEMS', columns: [{ header: 'Cant.', value: '{{row.QTY}}', width: { fr: 1 } }], repeatHeader: true },
      { type: 'signatures', slots: [{ stepName: 'Revisión', signerType: 'CREATOR' }], perRow: 2, height: 60 },
    ]);
    expect(validateDesign(ok, doc)).toEqual([]);
  });
  it('reports unknown fields (also in visibility rules and exclusions), tables used as text and text used as tables', () => {
    const problems = validateDesign(
      design([
        { type: 'text', text: '{{field.NOPE}}', visibleWhen: [{ field: 'GHOST', op: 'equals', value: 'x' }] },
        { type: 'text', text: '{{field.ITEMS}}' },
        { type: 'table', fieldCode: 'NAME', columns: [{ header: 'h', value: 'x', width: { fr: 1 } }], repeatHeader: false },
        { type: 'allFields', exclude: ['MISSING'] },
      ]),
      doc,
    );
    expect(codes(problems)).toEqual([
      'DOCUMENT_FIELD_UNKNOWN@body[0].visibleWhen[0]',
      'DOCUMENT_FIELD_UNKNOWN@body[0].text',
      'DOCUMENT_FIELD_TYPE_MISMATCH@body[1].text',
      'DOCUMENT_FIELD_TYPE_MISMATCH@body[2].fieldCode',
      'DOCUMENT_FIELD_UNKNOWN@body[3].exclude[0]',
    ]);
  });
  it('row paths only exist inside a table, and only for its columns', () => {
    const problems = validateDesign(design([{ type: 'text', text: '{{row.QTY}}' }, { type: 'table', fieldCode: 'ITEMS', columns: [{ header: 'h', value: '{{row.WRONG}}', width: { fr: 1 } }], repeatHeader: true }]), doc);
    expect(codes(problems)).toEqual(['DOCUMENT_ROW_OUTSIDE_TABLE@body[0].text', 'DOCUMENT_TABLE_COLUMN_UNKNOWN@body[1].columns[0].value']);
  });
  it('page numbers only make sense in the header or footer', () => {
    expect(codes(validateDesign(design([{ type: 'text', text: '{{page}}' }]), doc))).toEqual(['PAGE_AND_PAGES_OUTSIDE_BAND@body[0].text']);
    expect(validateDesign(design([], { footer: { height: 20, blocks: [{ type: 'text', text: '{{page}}/{{pages}}' }] } }), doc)).toEqual([]);
  });
  it('signature steps must exist and be steps of people', () => {
    const problems = validateDesign(design([{ type: 'signatures', slots: [{ stepName: 'Nadie', signerType: 'USER' }, { stepName: 'auto', signerType: 'USER' }], perRow: 2, height: 60 }]), doc);
    expect(codes(problems)).toEqual(['DOCUMENT_SIGNATURE_STEP_UNKNOWN@body[0].slots[0]', 'DOCUMENT_SIGNATURE_STEP_NOT_PEOPLE@body[0].slots[1]']);
  });
  it('step references in expressions must name an existing step', () => {
    expect(codes(validateDesign(design([{ type: 'text', text: '{{step.Fantasma.completedAt}}' }]), doc))).toEqual(['DOCUMENT_STEP_UNKNOWN@body[0].text']);
  });
});

describe('templateMappingSchema', () => {
  it('needs exactly a field code or an expression, coordinates for COORDINATES and a name for ACROFORM', () => {
    const ok = { fields: [{ mode: 'COORDINATES', fieldCode: 'NAME', page: 1, x: 10, y: 20 }, { mode: 'ACROFORM', expression: '{{ticket.number}}', acroformName: 'numero' }], signatures: [{ mode: 'COORDINATES', stepName: 'Revisión', signerType: 'CREATOR', page: 1, x: 1, y: 1, width: 100, height: 30 }] };
    expect(templateMappingSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { mode: 'COORDINATES', fieldCode: 'NAME', expression: 'x', page: 1, x: 1, y: 1 },
      { mode: 'COORDINATES', page: 1, x: 1, y: 1 },
      { mode: 'COORDINATES', fieldCode: 'NAME', page: 1 },
      { mode: 'ACROFORM', fieldCode: 'NAME' },
      { mode: 'COORDINATES', fieldCode: 'NAME', page: 1, x: -1, y: 1 },
      { mode: 'COORDINATES', fieldCode: 'NAME', page: 1, x: 1, y: 1, fontSize: 2 },
    ]) expect(templateMappingSchema.safeParse({ fields: [bad], signatures: [] }).success).toBe(false);
    expect(templateMappingSchema.safeParse({ fields: [], signatures: [{ mode: 'COORDINATES', stepName: 'S', signerType: 'USER', page: 1, x: 1, y: 1 }] }).success).toBe(false);
  });
});

describe('validateMapping', () => {
  const portrait: PageBox = { mediaBox: { x: 0, y: 0, w: 600, h: 800 }, rotation: 0 };
  const rotated: PageBox = { mediaBox: { x: 0, y: 0, w: 600, h: 800 }, rotation: 90 };
  const template = { pages: [portrait, rotated], acroformFields: [{ name: 'numero', type: 'TEXT' as const, page: 1, rect: null }] };
  const mapping = (fields: unknown[], signatures: unknown[] = []) => templateMappingSchema.parse({ fields, signatures });

  it('accepts a mapping that fits the PDF and the version', () => {
    expect(validateMapping(mapping([{ mode: 'ACROFORM', fieldCode: 'NAME', acroformName: 'numero' }, { mode: 'COORDINATES', expression: '{{ticket.number}}', page: 1, x: 500, y: 700 }]), template, doc)).toEqual([]);
  });
  it('rejects AcroForm names the PDF lacks, tables, unknown fields and steps', () => {
    const problems = validateMapping(
      mapping([{ mode: 'ACROFORM', fieldCode: 'NAME', acroformName: 'otro' }, { mode: 'COORDINATES', fieldCode: 'ITEMS', page: 1, x: 1, y: 1 }, { mode: 'COORDINATES', fieldCode: 'X', page: 1, x: 1, y: 1 }], [{ mode: 'ACROFORM', stepName: 'Nadie', signerType: 'USER', acroformName: 'firma' }]),
      template,
      doc,
    );
    expect(codes(problems)).toEqual(['ACROFORM_FIELD_UNKNOWN@fields[0].acroformName', 'DOCUMENT_FIELD_TYPE_MISMATCH@fields[1].fieldCode', 'DOCUMENT_FIELD_UNKNOWN@fields[2].fieldCode', 'DOCUMENT_SIGNATURE_STEP_UNKNOWN@signatures[0]', 'ACROFORM_FIELD_UNKNOWN@signatures[0].acroformName']);
  });
  it('coordinates must fall on the page as it is displayed (a rotated page swaps width and height)', () => {
    expect(validateMapping(mapping([{ mode: 'COORDINATES', fieldCode: 'NAME', page: 1, x: 601, y: 10 }]), template, doc).map((p) => p.code)).toEqual(['COORDINATE_OUT_OF_PAGE']);
    expect(validateMapping(mapping([{ mode: 'COORDINATES', fieldCode: 'NAME', page: 2, x: 700, y: 500 }]), template, doc)).toEqual([]);
    expect(validateMapping(mapping([{ mode: 'COORDINATES', fieldCode: 'NAME', page: 2, x: 10, y: 700 }]), template, doc).map((p) => p.code)).toEqual(['COORDINATE_OUT_OF_PAGE']);
    expect(validateMapping(mapping([{ mode: 'COORDINATES', fieldCode: 'NAME', page: 3, x: 1, y: 1 }]), template, doc).map((p) => p.code)).toEqual(['COORDINATE_OUT_OF_PAGE']);
  });
});

describe('sampleRenderValue', () => {
  it('gives display-ready samples by type, with option labels and table rows by column', () => {
    expect(sampleRenderValue(doc.fields[3]!)).toBe('Opción A');
    expect(sampleRenderValue(doc.fields[1]!)).toBe('1500000.00');
    const rows = sampleRenderValue(doc.fields[2]!) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ QTY: 100, ITEM: 'Ítem 1' });
  });
});
