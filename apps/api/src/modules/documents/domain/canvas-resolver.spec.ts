import { type CanvasElement, defaultCanvasStyle, emptyCanvasDesign, type FieldDocument, type PdfCanvasDesign } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { ResolvedCanvasElement } from '../../../infrastructure/pdf/canvas-document.js';
import { CanvasResolver } from './canvas-resolver.js';
import type { RenderFacts, SignerRecord } from './render-facts.js';

const field = (code: string, type: FieldDocument['type'], config: Record<string, unknown> = {}): FieldDocument => ({
  id: `f-${code}`,
  stepId: 's1',
  code,
  label: code,
  type,
  capture: 'CREATION',
  isRequired: false,
  isReadOnly: false,
  sortOrder: 0,
  config,
  dataSource: null,
});

const signer = (userId: string, name: string, at: string, imageKey: string | null = null): SignerRecord => ({ userId, name, signedAt: new Date(at), imageKey });

const facts = (values: Record<string, unknown> = {}): RenderFacts => ({
  ticket: { number: '1045', title: 'Arqueo', status: 'OPEN', createdAt: new Date('2026-10-01T13:00:00Z'), closedAt: null, companyName: 'Acme', creatorId: 'u-creator', creatorName: 'Pedro Pérez', currentStepName: 'Revisión' },
  timeZone: 'America/Bogota',
  currencyCode: 'COP',
  fields: [field('CASH', 'CURRENCY'), field('KIND', 'SELECT', { options: [{ value: 'int', label: 'Internacional' }] }), field('ITEMS', 'TABLE', { columns: [{ code: 'NAME', type: 'TEXT' }, { code: 'AMOUNT', type: 'NUMBER' }] })],
  values: { CASH: 1000, KIND: 'int', ITEMS: [{ NAME: 'Billetes', AMOUNT: 700.5 }, { NAME: 'Monedas', AMOUNT: 250.25 }], ...values },
  names: { users: new Map(), sites: new Map(), files: new Map() },
  signers: new Map([
    ['Revisión', [signer('u-ana', 'Ana', '2026-10-01T15:00:00Z', 'sig:u-ana'), signer('u-luis', 'Luis', '2026-10-01T16:30:00Z')]],
    ['Solicitud', [signer('u-creator', 'Pedro Pérez', '2026-10-01T13:00:00Z', 'sig:u-creator')]],
  ]),
  now: new Date('2026-10-02T15:00:00Z'),
});

const at = { x: 10, y: 10, width: 80, height: 8, repeat: false, locked: false, sheet: 0, condition: '', style: defaultCanvasStyle() };
const text = (id: string, content: string, condition = ''): CanvasElement => ({ ...at, id, name: id, type: 'text', content, grow: false, condition });
const signature = (id: string, extra: Partial<Extract<CanvasElement, { type: 'signature' }>>): CanvasElement => ({ ...at, id, name: id, type: 'signature', source: 'STEP', stepName: 'Revisión', signers: 'LAST', position: 1, label: '', showName: true, showDate: true, showLine: true, ...extra }) as CanvasElement;

const resolve = (design: Partial<PdfCanvasDesign>, values: Record<string, unknown> = {}) => new CanvasResolver(facts(values)).resolve({ ...emptyCanvasDesign(), elements: [], ...design });
const textOf = (element: ResolvedCanvasElement | undefined) => (element?.type === 'text' ? element.text(undefined) : undefined);

describe('CanvasResolver', () => {
  it('works out the calculations in order and prints them with their decimals', () => {
    const resolved = resolve({
      calculations: [
        { code: 'COUNTED', name: 'Contado', formula: 'SUM(ITEMS.AMOUNT)', decimals: 2 },
        { code: 'DIFFERENCE', name: 'Diferencia', formula: 'COUNTED - CASH', decimals: 0 },
        { code: 'BROKEN', name: 'Roto', formula: 'CASH / 0', decimals: 2 },
      ],
      elements: [text('a', '{{calc.COUNTED}} | {{calc.DIFFERENCE}} | {{calc.COUNTED|currency}} | [{{calc.BROKEN}}]')],
    });
    expect(textOf(resolved.content.elements[0])).toBe('950.75 | -49 | $ 950,75 | []');
  });

  it('prints an element or a sheet only when its condition is true (an unknown value is not true)', () => {
    const resolved = resolve({
      calculations: [{ code: 'DIFFERENCE', name: 'Diferencia', formula: 'SUM(ITEMS.AMOUNT) - CASH', decimals: 2 }],
      sheets: [
        { name: '', condition: '' },
        { name: 'Anexo', condition: 'KIND = "int"' },
        { name: 'Nacional', condition: 'KIND = "nat"' },
      ],
      elements: [text('missing', 'Faltante', 'DIFFERENCE < 0'), text('surplus', 'Sobrante', 'DIFFERENCE > 0')],
    });
    expect(resolved.content.elements.map((element) => element.id)).toEqual(['missing']);
    expect(resolved.content.sheets).toEqual([0, 1]);
    const unknown = resolve({ elements: [text('positive', 'Positivo', 'CASH > 0'), text('always', 'Siempre')] }, { CASH: null });
    expect(unknown.content.elements.map((element) => element.id)).toEqual(['always']);
  });

  it('lists the rows of a table and adds up the columns marked, formatted like their cells', () => {
    const table: CanvasElement = {
      ...at,
      id: 't',
      name: 't',
      type: 'table',
      fieldCode: 'ITEMS',
      columns: [
        { header: 'Concepto', value: '{{row.NAME|upper}}', align: 'LEFT', weight: 2, sum: false },
        { header: 'Valor', value: '$ {{row.AMOUNT|number:2}}', align: 'RIGHT', weight: 1, sum: true },
      ],
      showHeader: true,
      headerStyle: defaultCanvasStyle(),
      zebra: null,
      showTotals: true,
      totalLabel: 'Total',
      minRows: 0,
      emptyMessage: '',
    };
    const [resolved] = resolve({ elements: [table] }).content.elements;
    expect(resolved).toMatchObject({
      type: 'table',
      headers: ['Concepto', 'Valor'],
      rows: [
        ['BILLETES', '$ 700,50'],
        ['MONEDAS', '$ 250,25'],
      ],
      totals: [null, '$ 950,75'],
    });
  });

  it('fills signature boxes with the last, every or the n-th signer of a step, the requester, or nobody', () => {
    const resolved = resolve({
      elements: [
        signature('last', {}),
        signature('all', { signers: 'ALL' }),
        signature('first', { signers: 'POSITION', position: 1 }),
        signature('third', { signers: 'POSITION', position: 3 }),
        signature('requester', { source: 'REQUESTER', stepName: null }),
        signature('blank', { source: 'BLANK', stepName: null }),
        signature('unsigned', { stepName: 'Aprobación' }),
      ],
    });
    const signers = Object.fromEntries(resolved.content.elements.map((element) => [element.id, element.type === 'signature' ? element.signers : undefined]));
    expect(signers).toEqual({
      last: [{ name: 'Luis', date: '01/10/2026 11:30', imageKey: null }],
      all: [
        { name: 'Ana', date: '01/10/2026 10:00', imageKey: 'sig:u-ana' },
        { name: 'Luis', date: '01/10/2026 11:30', imageKey: null },
      ],
      first: [{ name: 'Ana', date: '01/10/2026 10:00', imageKey: 'sig:u-ana' }],
      third: [null],
      requester: [{ name: 'Pedro Pérez', date: null, imageKey: 'sig:u-creator' }],
      blank: [null],
      unsigned: [null],
    });
  });

  it('says when the logo is used and keeps the sheet size in millimetres', () => {
    const logo: CanvasElement = { ...at, id: 'logo', name: 'logo', type: 'image', source: 'TENANT_LOGO', fit: 'CONTAIN' };
    const resolved = resolve({ elements: [logo], page: { size: 'A4', orientation: 'LANDSCAPE', marginBottom: 12 } });
    expect(resolved.usesLogo).toBe(true);
    expect(resolved.content.page).toEqual({ width: 297, height: 210, marginBottom: 12 });
    expect(resolved.content.elements[0]).toMatchObject({ type: 'image', imageKey: 'logo' });
  });
});
