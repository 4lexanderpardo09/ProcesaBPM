import { describe, expect, it } from 'vitest';
import { emptyDesign, type FieldDocument, type PdfDesign, PdfDesignInvalidError } from '@procesabpm/shared';
import { DesignResolver } from './design-resolver.js';
import type { RenderFacts, SignerRecord } from './render-facts.js';
import { resolveTemplateFields, resolveTemplateSignatures } from './template-resolver.js';

const field = (code: string, type: FieldDocument['type'], label: string, config: Record<string, unknown> = {}): FieldDocument => ({
  id: `f-${code}`,
  stepId: 's1',
  code,
  label,
  type,
  capture: 'CREATION',
  isRequired: false,
  isReadOnly: false,
  sortOrder: 0,
  config,
  dataSource: null,
});

const ana: SignerRecord = { userId: 'u-ana', name: 'Ana Gómez', signedAt: new Date('2026-10-01T15:00:00Z'), imageKey: 'sig:u-ana' };

const facts = (overrides: Partial<RenderFacts> = {}): RenderFacts => ({
  ticket: { number: '1045', title: 'Compra de equipos', status: 'OPEN', createdAt: new Date('2026-10-01T13:00:00Z'), closedAt: null, companyName: 'Acme SAS', creatorId: 'u-creator', creatorName: 'Pedro Pérez', currentStepName: 'Revisión' },
  timeZone: 'America/Bogota',
  currencyCode: 'COP',
  fields: [
    field('PROVIDER', 'TEXT', 'Proveedor'),
    field('KIND', 'SELECT', 'Tipo', { options: [{ value: 'a', label: 'Equipos' }] }),
    field('AMOUNT', 'CURRENCY', 'Valor'),
    field('DUE', 'DATE', 'Vence'),
    field('ITEMS', 'TABLE', 'Ítems', { columns: [{ code: 'NAME', label: 'Nombre', type: 'TEXT' }, { code: 'QTY', label: 'Cantidad', type: 'NUMBER' }] }),
  ],
  values: { PROVIDER: 'Ñandú S.A.', KIND: 'a', AMOUNT: 1500000, DUE: '2026-03-05', ITEMS: [{ NAME: 'Mesa', QTY: 2.5 }, { NAME: 'Silla', QTY: 4 }] },
  names: { users: new Map(), sites: new Map(), files: new Map() },
  signers: new Map([['Aprobación', [ana]]]),
  now: new Date('2026-10-02T15:00:00Z'),
  ...overrides,
});

const design = (body: PdfDesign['body'], extra: Partial<PdfDesign> = {}): PdfDesign => ({ ...emptyDesign(), body, ...extra });
const resolve = (body: PdfDesign['body'], overrides: Partial<RenderFacts> = {}, extra: Partial<PdfDesign> = {}) => new DesignResolver(facts(overrides)).resolve(design(body, extra));

describe('DesignResolver', () => {
  it('evaluates text with ticket data, field labels and formatted values', () => {
    const { body } = resolve([{ type: 'text', text: 'Ticket {{ticket.number}} · {{field.PROVIDER|upper}} · {{field.KIND}} · {{field.AMOUNT|currency}} · {{field.DUE}}' }]);
    expect(body[0]).toMatchObject({ type: 'text' });
    expect((body[0] as { text: string }).text).toBe('Ticket 1045 · ÑANDÚ S.A. · Equipos · $\u00a01.500.000,00 · 05/03/2026');
  });

  it('lists every filled field with its label, leaving the tables out', () => {
    const { body } = resolve([{ type: 'allFields' }]);
    expect(body[0]).toMatchObject({ type: 'fields', columns: 1, rows: [{ label: 'Proveedor', value: 'Ñandú S.A.' }, { label: 'Tipo', value: 'Equipos' }, { label: 'Valor', value: '$\u00a01.500.000,00' }, { label: 'Vence', value: '05/03/2026' }] });
    expect(resolve([{ type: 'allFields', exclude: ['PROVIDER'] }]).body[0]).toMatchObject({ rows: expect.not.arrayContaining([{ label: 'Proveedor', value: 'Ñandú S.A.' }]) });
  });

  it('shows a block only when its conditions hold', () => {
    const blocks: PdfDesign['body'] = [{ type: 'text', text: 'grande', visibleWhen: [{ field: 'AMOUNT', op: 'gt', value: 1000000 }] }, { type: 'text', text: 'chico', visibleWhen: [{ field: 'AMOUNT', op: 'lt', value: 1000 }] }];
    expect(resolve(blocks).body.map((block) => (block as { text: string }).text)).toEqual(['grande']);
  });

  it('builds a table from the stored rows and adds up a column exactly', () => {
    const { body } = resolve([{ type: 'table', fieldCode: 'ITEMS', repeatHeader: true, columns: [{ header: 'Nombre', value: '{{row.NAME}}', width: { fr: 2 } }, { header: 'Cant.', value: '{{row.QTY}}', width: { pt: 60 }, align: 'RIGHT' }], totals: [{ column: 1 }] }]);
    expect(body[0]).toMatchObject({ type: 'table', headers: ['Nombre', 'Cant.'], rows: [['Mesa', '2.5'], ['Silla', '4']], totals: ['Total', '6,5'] });
  });

  it('puts the page numbers only in the header and footer, resolved per page', () => {
    const resolved = resolve([{ type: 'text', text: 'x' }], {}, { footer: { height: 20, blocks: [{ type: 'text', text: 'Página {{page}} de {{pages}}' }] } });
    expect((resolved.footer!.resolve(2, 5)[0] as { text: string }).text).toBe('Página 2 de 5');
  });

  it('prints who signed and when, or says the signature is pending', () => {
    const { body } = resolve([{ type: 'signatures', perRow: 2, height: 50, slots: [{ stepName: 'Aprobación', signerType: 'APPROVER' }, { stepName: 'Jurídica', signerType: 'POSITION', signerLabel: 'Jefe jurídico' }] }]);
    expect(body[0]).toMatchObject({ type: 'signatures', slots: [{ caption: 'Firmado por Ana Gómez · 01/10/2026', imageKey: 'sig:u-ana' }, { caption: 'Pendiente: Jefe jurídico', imageKey: null }] });
  });

  it('exposes the person and date of a step to expressions', () => {
    expect((resolve([{ type: 'text', text: '{{step.Aprobación.completedBy}} el {{step.Aprobación.completedAt|date}}' }]).body[0] as { text: string }).text).toBe('Ana Gómez el 01/10/2026');
  });

  it('uses the page size and orientation, and notes when a logo is needed', () => {
    const resolved = resolve([{ type: 'image', source: 'TENANT_LOGO', width: 100 }], {}, { page: { ...emptyDesign().page, size: 'LETTER', orientation: 'LANDSCAPE' } });
    expect(resolved.page).toMatchObject({ width: 792, height: 612 });
    expect(resolved.usesLogo).toBe(true);
    expect(resolved.body[0]).toMatchObject({ type: 'image', imageKey: 'logo', width: 100, height: 40 });
  });

  it('refuses a design whose expression no longer parses', () => {
    const broken = { ...design([{ type: 'text', text: '{{nonsense}}' }]) };
    expect(() => new DesignResolver(facts()).resolve(broken)).toThrow(PdfDesignInvalidError);
  });
});

describe('template mapping', () => {
  const resolver = new DesignResolver(facts());

  it('fills mapped places from a field or an expression', () => {
    const filled = resolveTemplateFields(
      [
        { mode: 'ACROFORM', fieldCode: 'PROVIDER', expression: null, acroformName: 'proveedor', page: null, x: null, y: null, fontSize: null, maxWidth: null, align: null },
        { mode: 'COORDINATES', fieldCode: null, expression: 'Ticket {{ticket.number}}', acroformName: null, page: 1, x: 100, y: 700, fontSize: 12, maxWidth: 200, align: 'RIGHT' },
      ],
      resolver,
    );
    expect(filled).toEqual([
      { mode: 'ACROFORM', name: 'proveedor', value: 'Ñandú S.A.' },
      { mode: 'COORDINATES', page: 1, x: 100, y: 700, value: 'Ticket 1045', fontSize: 12, maxWidth: 200, align: 'RIGHT' },
    ]);
  });

  it('places signatures at their boxes with the signer caption', () => {
    const signatures = resolveTemplateSignatures(
      [{ mode: 'COORDINATES', stepName: 'Aprobación', signerType: 'APPROVER', signerLabel: null, acroformName: null, page: 1, x: 50, y: 60, width: 120, height: 40 }],
      resolver,
    );
    expect(signatures).toEqual([{ target: { mode: 'COORDINATES', page: 1, x: 50, y: 60, width: 120, height: 40 }, caption: 'Firmado por Ana Gómez · 01/10/2026', imageKey: 'sig:u-ana' }]);
  });
});
