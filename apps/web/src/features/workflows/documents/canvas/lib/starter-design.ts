import { type CanvasElement, type CanvasStyle, defaultCanvasStyle, type FieldDocument, type PdfCanvasDesign, type WorkflowVersionDocument } from '@procesabpm/shared';
import { fieldPlaceholder, signingSteps } from '../../lib/data-choices';

/** The words the starter writes on the sheet, in the person's language. */
export interface StarterLabels {
  readonly requestData: string;
  readonly company: string;
  readonly requester: string;
  readonly createdAt: string;
  readonly status: string;
  readonly signatures: string;
  readonly requesterSignature: string;
  readonly total: string;
  readonly noRows: string;
  readonly page: string;
}

const BLUE = '#1F4E79';
const LIGHT = '#E3EAF2';
/** Letter, portrait: the sheet is 215.9 mm wide; 12 mm each side. */
const X0 = 12;
const WIDTH = 191.9;
const ROW = 6;
/** Where the generated rows stop, so the signatures still fit on the first page. */
const LAST_ROW_Y = 215;
const MAX_SIGNATURES = 4;
/** Values that are not one line of text: a table gets its own block, a file is listed with the attachments. */
const NOT_IN_GRID: ReadonlySet<string> = new Set(['TABLE', 'FILE', 'TEXTAREA']);
const NUMERIC: ReadonlySet<string> = new Set(['NUMBER', 'CURRENCY', 'FORMULA']);
const COLUMN_FORMATTER: Readonly<Partial<Record<string, string>>> = { NUMBER: '|number', CURRENCY: '|currency', DATE: '|date' };

const style = (changes: Partial<CanvasStyle> = {}): CanvasStyle => ({ ...defaultCanvasStyle(), size: 9, ...changes });
const cell = style({ border: 0.5, borderColor: BLUE, verticalAlign: 'MIDDLE', padding: 1.5 });
const label = style({ border: 0.5, borderColor: BLUE, verticalAlign: 'MIDDLE', padding: 1.5, bold: true, background: LIGHT });
const bar = style({ bold: true, color: '#FFFFFF', background: BLUE, verticalAlign: 'MIDDLE', padding: 2 });
/** A name can be printed as it is only without the braces the placeholders use. */
const literal = (text: string) => text.replace(/[{}]/g, '');

interface Column {
  readonly code: string;
  readonly label: string;
  readonly type: string;
}

const columnsOf = (field: FieldDocument): Column[] =>
  Array.isArray(field.config['columns'])
    ? (field.config['columns'] as Array<{ code?: unknown; label?: unknown; type?: unknown }>).flatMap((column) =>
        typeof column.code === 'string' ? [{ code: column.code, label: typeof column.label === 'string' ? column.label : column.code, type: typeof column.type === 'string' ? column.type : 'TEXT' }] : [],
      )
    : [];

/**
 * A ready-made format for the workflow, the help desk's "plantillas de inicio" (the F23 cash count) drawn with this
 * workflow's own data so it can be saved at once: a header repeated on every page (logo, title, ticket number and date),
 * the request data as a grid of labels and values, a long text and a table per field that holds one (they grow and push
 * what is below), the signatures of the requester and of the steps people sign, and the page number. Fields that do not
 * fit on the first page are left for the person to place.
 */
export function starterCanvasDesign(document: WorkflowVersionDocument, title: string, labels: StarterLabels): PdfCanvasDesign {
  const elements: CanvasElement[] = [];
  let next = 0;
  const id = (prefix: string) => `${prefix}-${String(++next)}`;
  const common = { repeat: false, locked: false, sheet: 0, condition: '' };
  const text = (name: string, content: string, x: number, y: number, width: number, height: number, look: CanvasStyle, extra: { repeat?: boolean; grow?: boolean } = {}) =>
    elements.push({ ...common, id: id('text'), name, type: 'text', content, grow: extra.grow ?? false, x, y, width, height, style: look, repeat: extra.repeat ?? false });

  elements.push({ ...common, id: id('logo'), name: 'Logo', type: 'image', source: 'TENANT_LOGO', fit: 'CONTAIN', x: X0, y: 10, width: 40, height: 16, repeat: true, style: cell });
  text('Título', literal(title).toUpperCase(), X0 + 40, 10, WIDTH - 80, 16, style({ border: 0.5, borderColor: BLUE, size: 13, bold: true, align: 'CENTER', verticalAlign: 'MIDDLE', color: BLUE }), { repeat: true });
  text('Número y fecha', 'Ticket #{{ticket.number}}\n{{ticket.createdAt|date}}', X0 + WIDTH - 40, 10, 40, 16, style({ border: 0.5, borderColor: BLUE, size: 8, align: 'CENTER', verticalAlign: 'MIDDLE' }), { repeat: true });

  let y = 30;
  text(labels.requestData, labels.requestData.toUpperCase(), X0, y, WIDTH, 7, bar);
  y += 7;
  const pairs: Array<[string, string]> = [
    [labels.company, '{{ticket.companyName}}'],
    [labels.requester, '{{ticket.creatorName}}'],
    [labels.createdAt, '{{ticket.createdAt|date}}'],
    [labels.status, '{{ticket.status}}'],
    ...document.fields.filter((field) => !NOT_IN_GRID.has(field.type)).map((field): [string, string] => [literal(field.label), fieldPlaceholder(field)]),
  ];
  const half = WIDTH / 2;
  let placed = 0;
  for (const [index, [name, value]] of pairs.entries()) {
    const rowY = y + Math.floor(index / 2) * ROW;
    if (rowY > LAST_ROW_Y) break;
    const x = X0 + (index % 2) * half;
    text(name, name, x, rowY, half * 0.4, ROW, label);
    text(`${name} (valor)`, value, x + half * 0.4, rowY, half * 0.6, ROW, cell);
    placed = index + 1;
  }
  y += Math.ceil(placed / 2) * ROW + 4;

  for (const field of document.fields.filter((candidate) => candidate.type === 'TEXTAREA')) {
    if (y > LAST_ROW_Y) break;
    text(literal(field.label), literal(field.label), X0, y, WIDTH, ROW, label);
    text(`${literal(field.label)} (valor)`, fieldPlaceholder(field), X0, y + ROW, WIDTH, 12, style({ border: 0.5, borderColor: BLUE, padding: 1.5 }), { grow: true });
    y += ROW + 12 + 4;
  }

  for (const field of document.fields.filter((candidate) => candidate.type === 'TABLE')) {
    const columns = columnsOf(field);
    if (columns.length === 0 || y > LAST_ROW_Y) continue;
    text(literal(field.label), literal(field.label).toUpperCase(), X0, y, WIDTH, 7, bar);
    const sums = columns.some((column) => column.type === 'NUMBER' || column.type === 'CURRENCY');
    elements.push({
      ...common,
      id: id('table'),
      name: literal(field.label),
      type: 'table',
      fieldCode: field.code,
      columns: columns.map((column) => ({
        header: literal(column.label),
        value: `{{row.${column.code}${COLUMN_FORMATTER[column.type] ?? ''}}}`,
        align: NUMERIC.has(column.type) ? 'RIGHT' : 'LEFT',
        weight: NUMERIC.has(column.type) ? 2 : 3,
        sum: column.type === 'NUMBER' || column.type === 'CURRENCY',
      })),
      showHeader: true,
      headerStyle: style({ bold: true, background: LIGHT, border: 0.5, borderColor: BLUE, padding: 1.5 }),
      zebra: null,
      showTotals: sums,
      totalLabel: labels.total,
      minRows: 0,
      emptyMessage: labels.noRows,
      x: X0,
      y: y + 7,
      width: WIDTH,
      height: 12,
      style: cell,
    });
    y += 7 + 12 + 4;
  }

  const signers = signingSteps(document).slice(0, MAX_SIGNATURES - 1);
  const boxWidth = WIDTH / (signers.length + 1);
  text(labels.signatures, labels.signatures.toUpperCase(), X0, y, WIDTH, 7, bar);
  const signature = { position: 1, showName: true, showDate: true, showLine: true, y: y + 9, width: boxWidth - 4, height: 24, style: style({ align: 'CENTER', size: 8 }) };
  elements.push({ ...common, ...signature, id: id('signature'), name: labels.requesterSignature, type: 'signature', source: 'REQUESTER', stepName: null, signers: 'LAST', label: labels.requesterSignature, x: X0 + 2 });
  for (const [index, step] of signers.entries()) {
    elements.push({ ...common, ...signature, id: id('signature'), name: literal(step.name), type: 'signature', source: 'STEP', stepName: step.name, signers: 'LAST', label: literal(step.name), x: X0 + 2 + (index + 1) * boxWidth });
  }

  text(labels.page, `${labels.page} {{page}} / {{pages}}`, X0 + WIDTH - 50, 268, 50, 6, style({ size: 8, align: 'RIGHT', color: '#6B7280' }), { repeat: true });

  return { version: 2, page: { size: 'LETTER', orientation: 'PORTRAIT', marginBottom: 15 }, sheets: [{ name: '', condition: '' }], calculations: [], elements };
}
