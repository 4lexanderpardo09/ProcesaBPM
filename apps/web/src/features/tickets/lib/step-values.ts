import { compileRowFormulas, type FormFieldResponse, withRowFormulas } from '@procesabpm/shared';

/** One row of a TABLE field as typed: text per column code. */
export type TableRow = Readonly<Record<string, string>>;

/** What the person types, per field: text for single inputs, a list for multiple choice, rows for a table. */
export type InputValue = string | readonly string[] | readonly TableRow[];

const DECIMAL = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;

/** A TABLE column, as `config.columns` describes it. */
export interface TableColumn {
  readonly code: string;
  readonly label: string;
  readonly type: 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'SELECT' | 'FORMULA';
  readonly required?: boolean;
  readonly options?: readonly Option[];
  /** FORMULA columns: computed from the row, never typed nor sent. */
  readonly expression?: string;
  readonly decimals?: number;
}

/** Where a list or a person/site field takes its choices from, when they are not `config.options`. */
export type ChoiceSource = 'REFERENCE' | 'DATASET';

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** The options a list offers on its own (`config.options`); a list fed by a preset or a dataset has none here. */
export function optionsOf(field: FormFieldResponse): readonly Option[] {
  const options = field.config['options'];
  return Array.isArray(options) ? (options as readonly Option[]) : [];
}

/**
 * Whether the choices are asked to the API: people, sites and preset lists by id (`/fields/:id/options`), dataset
 * lists by value (`/fields/:id/dataset-options`). `undefined` for a list with its own options or a free field.
 */
export function choiceSourceOf(field: FormFieldResponse): ChoiceSource | undefined {
  if (field.type === 'USER' || field.type === 'SITE') return 'REFERENCE';
  const kind = field.dataSource?.['kind'];
  if (kind === 'DATASET') return 'DATASET';
  if (kind === 'PRESET' && (field.type === 'SELECT' || field.type === 'MULTI_SELECT')) return 'REFERENCE';
  return undefined;
}

export function columnsOf(field: FormFieldResponse): readonly TableColumn[] {
  const columns = field.config['columns'];
  return Array.isArray(columns) ? (columns as readonly TableColumn[]) : [];
}

/** The value already on the ticket, as the input shows it. */
export function initialInput(field: FormFieldResponse, value: unknown): InputValue {
  if (field.type === 'MULTI_SELECT' || field.type === 'FILE') return Array.isArray(value) ? value.map(String) : [];
  if (field.type === 'TABLE') {
    // Formula cells are computed on screen from the rest of the row: they are not part of what is typed.
    const computed = new Set(columnsOf(field).filter((column) => column.type === 'FORMULA').map((column) => column.code));
    return Array.isArray(value) ? value.map((row) => Object.fromEntries(Object.entries(tableRowOf(row)).filter(([code]) => !computed.has(code)))) : [];
  }
  if (value === null || value === undefined) return '';
  if (field.type === 'DATETIME' && typeof value === 'string') return toLocalDateTime(value);
  return String(value);
}

export function isBlankInput(input: InputValue | undefined): boolean {
  if (input === undefined) return true;
  if (typeof input === 'string') return input.trim() === '';
  return (input as readonly (string | TableRow)[]).every((entry) => typeof entry !== 'string' && isBlankRow(entry));
}

/** Dots between groups of three digits and no comma: "350.000" and "1.250.000" are thousands (as written in Colombia). */
const THOUSANDS = /^-?\d{1,3}(\.\d{3})+$/;

/**
 * "1.250.000,50", "350.000" or "1250000.50" as the API's decimal text ("1250000.50"); `undefined` when it is not a
 * number. A comma is the decimal mark; without one, dots that group thousands are thousands, any other dot a decimal.
 */
export function decimalText(input: string): string | undefined {
  const compact = input.trim().replace(/\s/g, '');
  const text = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : THOUSANDS.test(compact) ? compact.replace(/\./g, '') : compact;
  return DECIMAL.test(text) ? text : undefined;
}

export type RequestValue = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/**
 * The value the API expects for what was typed: decimals as text (they can exceed a JSON number), days as an integer,
 * a date-time with its offset. Blank means "no value" (`null`). The API validates the rest (ranges, decimals, options).
 */
export function requestValue(field: FormFieldResponse, input: InputValue): RequestValue {
  if (isBlankInput(input)) return { ok: true, value: field.type === 'TABLE' ? [] : null };
  if (field.type === 'TABLE') return tableValue(columnsOf(field), input as readonly TableRow[]);
  if (typeof input !== 'string') return { ok: true, value: [...input] };
  switch (field.type) {
    case 'NUMBER':
    case 'CURRENCY': {
      const text = decimalText(input);
      return text === undefined ? { ok: false } : { ok: true, value: text };
    }
    case 'DAYS':
      return INTEGER.test(input.trim()) ? { ok: true, value: Number(input.trim()) } : { ok: false };
    case 'DATETIME': {
      const time = new Date(input).getTime();
      return Number.isNaN(time) ? { ok: false } : { ok: true, value: new Date(time).toISOString() };
    }
    default:
      return { ok: true, value: input.trim() };
  }
}

/**
 * The rows the API expects: blank rows are dropped, blank cells left out, numbers as decimal text. Required cells and
 * row limits are checked by the API, which marks the field.
 */
function tableValue(columns: readonly TableColumn[], rows: readonly TableRow[]): RequestValue {
  const value: Record<string, string>[] = [];
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const cells: Record<string, string> = {};
    for (const column of columns) {
      if (column.type === 'FORMULA') continue;
      const text = (row[column.code] ?? '').trim();
      if (text === '') continue;
      if (column.type === 'NUMBER' || column.type === 'CURRENCY') {
        const decimal = decimalText(text);
        if (decimal === undefined) return { ok: false };
        cells[column.code] = decimal;
      } else cells[column.code] = text;
    }
    value.push(cells);
  }
  return { ok: true, value };
}

const isBlankRow = (row: TableRow): boolean => Object.values(row).every((cell) => cell.trim() === '');

function tableRowOf(row: unknown): TableRow {
  if (typeof row !== 'object' || row === null) return {};
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([code, cell]) => [code, cell === null || cell === undefined ? '' : String(cell)]));
}

/** `2026-10-20T19:30:00.000Z` as a `datetime-local` value in the browser's time zone. */
function toLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The formula cells of a typed row, computed as the API will (the same engine), for the person to see them as they type.
 * A cell the row cannot give yet (an empty or wrong number) is absent.
 */
export function formulaCellsOf(columns: readonly TableColumn[], row: TableRow, today: string): Readonly<Record<string, number | string>> {
  const formulas = compileRowFormulas(columns);
  if (formulas.length === 0) return {};
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    const text = (row[column.code] ?? '').trim();
    if (text === '' || column.type === 'FORMULA') continue;
    values[column.code] = column.type === 'NUMBER' || column.type === 'CURRENCY' ? decimalText(text) : text;
  }
  const computed = withRowFormulas(values, formulas, today);
  return Object.fromEntries(formulas.flatMap((formula) => (computed[formula.code] === undefined ? [] : [[formula.code, computed[formula.code] as number | string]])));
}
