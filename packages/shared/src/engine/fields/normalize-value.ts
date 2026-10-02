import type { FieldDocument } from '../../workflow/document.js';
import { decimalPlaces } from '../money/decimal.js';
import type { FieldIssueCode, ReferenceToVerify, ValidationContext } from './types.js';

type Config = Record<string, unknown>;
export type Normalized = { readonly ok: true; readonly value: unknown; readonly references: readonly Omit<ReferenceToVerify, 'fieldCode'>[] } | { readonly ok: false; readonly code: FieldIssueCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

const good = (value: unknown, references: readonly Omit<ReferenceToVerify, 'fieldCode'>[] = []): Normalized => ({ ok: true, value, references });
const bad = (code: FieldIssueCode): Normalized => ({ ok: false, code });
const asNumber = (config: Config, key: string): number | undefined => (typeof config[key] === 'number' ? (config[key] as number) : undefined);
const optionValues = (config: Config): readonly string[] | undefined =>
  Array.isArray(config.options) && config.options.length > 0 ? (config.options as Array<{ value: string }>).map((option) => option.value) : undefined;

/** An empty value (`undefined`, `null`, blank text, empty list) is "not answered". */
export const isBlankValue = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);

function normalizeNumber(raw: unknown, config: Config, maxDecimals: number): Normalized {
  const text = typeof raw === 'number' ? (Number.isFinite(raw) ? raw : undefined) : typeof raw === 'string' && DECIMAL.test(raw.trim()) ? raw.trim() : undefined;
  if (text === undefined) return bad('INVALID_TYPE');
  const value = Number(text);
  if (!Number.isSafeInteger(Math.trunc(value))) return bad('OUT_OF_RANGE');
  if (decimalPlaces(text) > maxDecimals) return bad('TOO_MANY_DECIMALS');
  const min = asNumber(config, 'min');
  const max = asNumber(config, 'max');
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) return bad('OUT_OF_RANGE');
  return good(value);
}

function resolveDateBound(bound: unknown, today: string): string | undefined {
  if (bound === 'TODAY') return today;
  return typeof bound === 'string' && DATE.test(bound) ? bound : undefined;
}

const isRealDate = (text: string): boolean => DATE.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

function normalizeDate(raw: unknown, config: Config, context: ValidationContext): Normalized {
  if (typeof raw !== 'string' || !isRealDate(raw.trim())) return bad('INVALID_TYPE');
  const value = raw.trim();
  const min = resolveDateBound(config.min, context.today);
  const max = resolveDateBound(config.max, context.today);
  return (min !== undefined && value < min) || (max !== undefined && value > max) ? bad('OUT_OF_RANGE') : good(value);
}

function normalizeDateTime(raw: unknown, config: Config, context: ValidationContext): Normalized {
  if (typeof raw !== 'string' || !DATETIME.test(raw.trim())) return bad('INVALID_TYPE');
  const parsed = Date.parse(raw.trim());
  if (Number.isNaN(parsed)) return bad('INVALID_TYPE');
  const day = new Date(parsed).toISOString().slice(0, 10);
  const min = resolveDateBound(config.min, context.today);
  const max = resolveDateBound(config.max, context.today);
  return (min !== undefined && day < min) || (max !== undefined && day > max) ? bad('OUT_OF_RANGE') : good(new Date(parsed).toISOString());
}

function normalizeSelectValue(raw: unknown, config: Config, dataSource: Record<string, unknown> | null): Normalized {
  if (typeof raw !== 'string' || raw.trim() === '') return bad('INVALID_TYPE');
  const value = raw.trim();
  const options = optionValues(config);
  if (options !== undefined) return options.includes(value) ? good(value) : bad('NOT_AN_OPTION');
  if (dataSource?.kind === 'PRESET') return UUID.test(value) ? good(value, [{ kind: 'PRESET', value, config: { preset: dataSource.preset } }]) : bad('INVALID_TYPE');
  if (dataSource?.kind === 'DATASET') return good(value, [{ kind: 'DATASET', value, config: { datasetId: dataSource.datasetId, column: dataSource.column } }]);
  return bad('NOT_AN_OPTION');
}

function normalizeMultiSelect(raw: unknown, config: Config, dataSource: Record<string, unknown> | null): Normalized {
  if (!Array.isArray(raw)) return bad('INVALID_TYPE');
  const values: string[] = [];
  const references: Array<Omit<ReferenceToVerify, 'fieldCode'>> = [];
  for (const item of raw) {
    const single = normalizeSelectValue(item, config, dataSource);
    if (!single.ok) return single;
    if (!values.includes(single.value as string)) {
      values.push(single.value as string);
      references.push(...single.references);
    }
  }
  const min = asNumber(config, 'minSelected');
  const max = asNumber(config, 'maxSelected');
  if ((min !== undefined && values.length < min) || (max !== undefined && values.length > max)) return bad('OUT_OF_RANGE');
  return good(values, references);
}

function normalizeText(raw: unknown, config: Config, dataSource: Record<string, unknown> | null, fallbackMax: number): Normalized {
  if (typeof raw !== 'string') return bad('INVALID_TYPE');
  const value = raw.trim();
  if (value.length > (asNumber(config, 'maxLength') ?? fallbackMax)) return bad('OUT_OF_RANGE');
  return good(value, dataSource?.kind === 'DATASET' ? [{ kind: 'DATASET', value, config: { datasetId: dataSource.datasetId, column: dataSource.column } }] : []);
}

function normalizeUuid(raw: unknown, kind: 'SITE' | 'USER', config: Config): Normalized {
  if (typeof raw !== 'string' || !UUID.test(raw.trim())) return bad('INVALID_TYPE');
  const value = raw.trim().toLowerCase();
  return good(value, [{ kind, value, config }]);
}

/** A FILE field holds the ids of confirmed uploads; the server checks they are attachable (owner, type, not used). */
function normalizeFiles(raw: unknown, config: Config): Normalized {
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string' && UUID.test(item.trim()))) return bad('INVALID_TYPE');
  const ids = [...new Set(raw.map((item: string) => item.trim().toLowerCase()))];
  if (ids.length > (asNumber(config, 'maxFiles') ?? 1)) return bad('TOO_MANY_FILES');
  return good(ids, ids.map((value) => ({ kind: 'FILE' as const, value, config: { accept: config.accept } })));
}

export interface TableColumn {
  readonly code: string;
  readonly type: 'TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'SELECT';
  readonly required?: boolean;
  readonly options?: unknown;
  readonly decimals?: number;
  readonly min?: number;
  readonly max?: number;
  readonly showTotal?: boolean;
}

export interface TableCell {
  readonly rowIndex: number;
  readonly column: string;
  readonly code: FieldIssueCode;
}

export type TableResult = { readonly ok: true; readonly value: ReadonlyArray<Record<string, unknown>> } | { readonly ok: false; readonly code: FieldIssueCode; readonly cells: readonly TableCell[] };

/** Rows of a TABLE field: every cell is normalized with its column's type; unknown columns are rejected. */
export function normalizeTable(raw: unknown, config: Config, context: ValidationContext): TableResult {
  if (!Array.isArray(raw)) return { ok: false, code: 'INVALID_TYPE', cells: [] };
  const columns = (config.columns as TableColumn[] | undefined) ?? [];
  const minRows = asNumber(config, 'minRows') ?? 0;
  const maxRows = asNumber(config, 'maxRows') ?? 200;
  if (raw.length > maxRows) return { ok: false, code: 'TOO_MANY_ROWS', cells: [] };
  if (raw.length < minRows) return { ok: false, code: 'TOO_FEW_ROWS', cells: [] };
  const cells: TableCell[] = [];
  const rows: Array<Record<string, unknown>> = [];
  raw.forEach((rawRow: unknown, rowIndex) => {
    if (typeof rawRow !== 'object' || rawRow === null || Array.isArray(rawRow)) {
      cells.push({ rowIndex, column: '', code: 'INVALID_TYPE' });
      return;
    }
    const input = rawRow as Record<string, unknown>;
    for (const name of Object.keys(input)) if (!columns.some((column) => column.code === name)) cells.push({ rowIndex, column: name, code: 'UNKNOWN_FIELD' });
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      const cell = input[column.code];
      if (isBlankValue(cell)) {
        if (column.required === true) cells.push({ rowIndex, column: column.code, code: 'REQUIRED' });
        continue;
      }
      const result = normalizeValue(column.type, { options: column.options, decimals: column.decimals, min: column.min, max: column.max }, null, cell, context);
      if (result.ok) row[column.code] = result.value;
      else cells.push({ rowIndex, column: column.code, code: result.code });
    }
    rows.push(row);
  });
  return cells.length > 0 ? { ok: false, code: 'INVALID_TYPE', cells } : { ok: true, value: rows };
}

/** Canonical value of one non-blank input for a field type. FORMULA and CALCULATOR never take client input. */
export function normalizeValue(type: FieldDocument['type'] | TableColumn['type'], config: Config, dataSource: Record<string, unknown> | null, raw: unknown, context: ValidationContext): Normalized {
  switch (type) {
    case 'TEXT':
      return normalizeText(raw, config, dataSource, 1000);
    case 'TEXTAREA':
      return normalizeText(raw, config, null, 10_000);
    case 'NUMBER':
      return normalizeNumber(raw, config, asNumber(config, 'decimals') ?? 0);
    case 'CURRENCY':
      return normalizeNumber(raw, config, 2);
    case 'DAYS':
      return typeof raw === 'number' && Number.isInteger(raw) ? normalizeNumber(raw, config, 0) : bad('INVALID_TYPE');
    case 'SELECT':
      return normalizeSelectValue(raw, config, dataSource);
    case 'MULTI_SELECT':
      return normalizeMultiSelect(raw, config, dataSource);
    case 'DATE':
      return normalizeDate(raw, config, context);
    case 'DATETIME':
      return normalizeDateTime(raw, config, context);
    case 'SITE':
      return normalizeUuid(raw, 'SITE', { level: config.level });
    case 'USER':
      return normalizeUuid(raw, 'USER', { positionIds: config.positionIds });
    case 'FILE':
      return normalizeFiles(raw, config);
    case 'TABLE':
    case 'FORMULA':
    case 'CALCULATOR':
      return bad('INVALID_TYPE');
  }
}
