import type { FormFieldResponse } from '@procesabpm/shared';

/** What the person types, per field: text for single inputs, a list for multiple choice. */
export type InputValue = string | readonly string[];

/** Field types the web can capture today; the rest (people, sites, tables, files, lists from presets or datasets) come later. */
const CAPTURABLE = new Set<FormFieldResponse['type']>(['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'DAYS', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME']);

const DECIMAL = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** The options a list offers on its own (`config.options`); a list fed by a preset or a dataset has none here. */
export function optionsOf(field: FormFieldResponse): readonly Option[] {
  const options = field.config['options'];
  return Array.isArray(options) ? (options as readonly Option[]) : [];
}

export function isCapturable(field: FormFieldResponse): boolean {
  if (!CAPTURABLE.has(field.type)) return false;
  if (field.type === 'SELECT' || field.type === 'MULTI_SELECT') return field.dataSource === null && optionsOf(field).length > 0;
  if (field.type === 'TEXT') return field.dataSource === null;
  return true;
}

/** The value already on the ticket, as the input shows it. */
export function initialInput(field: FormFieldResponse, value: unknown): InputValue {
  if (field.type === 'MULTI_SELECT') return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined) return '';
  if (field.type === 'DATETIME' && typeof value === 'string') return toLocalDateTime(value);
  return String(value);
}

export function isBlankInput(input: InputValue | undefined): boolean {
  return input === undefined || (typeof input === 'string' ? input.trim() === '' : input.length === 0);
}

/** "1.250.000,50" or "1250000.50" as the API's decimal text ("1250000.50"); `undefined` when it is not a number. */
export function decimalText(input: string): string | undefined {
  const compact = input.trim().replace(/\s/g, '');
  const text = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact;
  return DECIMAL.test(text) ? text : undefined;
}

export type RequestValue = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/**
 * The value the API expects for what was typed: decimals as text (they can exceed a JSON number), days as an integer,
 * a date-time with its offset. Blank means "no value" (`null`). The API validates the rest (ranges, decimals, options).
 */
export function requestValue(field: FormFieldResponse, input: InputValue): RequestValue {
  if (isBlankInput(input)) return { ok: true, value: null };
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

/** `2026-10-20T19:30:00.000Z` as a `datetime-local` value in the browser's time zone. */
function toLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
