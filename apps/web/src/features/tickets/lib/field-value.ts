import type { FormFieldResponse, TicketValueNamesResponse } from '@procesabpm/shared';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';

const LOCALE = 'es-CO';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** How a field's value reads on the ticket: as text, as a count, or as a person or site the organization no longer has. */
export type FieldValueDisplay =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'days'; readonly count: number }
  | { readonly kind: 'rows'; readonly count: number }
  | { readonly kind: 'unknown' };

interface Option {
  readonly value: string;
  readonly label: string;
}

/** What of a field its value's reading needs. */
type ReadField = Pick<FormFieldResponse, 'type' | 'config'>;

/** `undefined` when there is nothing to show: no value, or a file (those are listed with the attachments). */
export function fieldValueDisplay(field: ReadField, value: unknown, names: TicketValueNamesResponse, timeZone?: string): FieldValueDisplay | undefined {
  if (isEmpty(value) || field.type === 'FILE') return undefined;
  switch (field.type) {
    case 'SELECT':
      return text(optionLabel(field, String(value), names));
    case 'MULTI_SELECT':
      return text((Array.isArray(value) ? value : [value]).map((entry) => optionLabel(field, String(entry), names)).join(', '));
    case 'NUMBER':
      return numberText(value, { maximumFractionDigits: numberConfig(field, 'decimals') ?? 0 });
    case 'CURRENCY':
      return currencyText(value, stringConfig(field, 'currencyCode'));
    case 'DAYS':
      return toNumber(value) === undefined ? text(String(value)) : { kind: 'days', count: toNumber(value) ?? 0 };
    case 'DATE':
      return text(dateText(String(value), timeZone));
    case 'DATETIME':
      return text(formatDateTime(String(value), timeZone));
    case 'TABLE':
      return { kind: 'rows', count: Array.isArray(value) ? value.length : 0 };
    case 'SITE':
      return named(names.sites[String(value)]);
    case 'USER':
      return named(names.users[String(value)]);
    case 'FORMULA':
      return formulaText(field, value, timeZone);
    default:
      return typeof value === 'number' ? numberText(value, { maximumFractionDigits: 6 }) : text(String(value));
  }
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

const text = (value: string): FieldValueDisplay => ({ kind: 'text', text: value });

const named = (name: string | undefined): FieldValueDisplay => (name === undefined ? { kind: 'unknown' } : text(name));

/** The option's label; lists from presets (people, sites, companies, departments, positions) hold ids the API names in `valueNames`. */
function optionLabel(field: ReadField, value: string, names: TicketValueNamesResponse): string {
  const options = field.config['options'];
  const label = Array.isArray(options) ? (options as readonly Option[]).find((option) => option.value === value)?.label : undefined;
  return label ?? names.users[value] ?? names.sites[value] ?? names.companies[value] ?? names.departments[value] ?? names.positions[value] ?? value;
}

function numberConfig(field: ReadField, key: string): number | undefined {
  const value = field.config[key];
  return typeof value === 'number' ? value : undefined;
}

function stringConfig(field: ReadField, key: string): string | undefined {
  const value = field.config[key];
  return typeof value === 'string' ? value : undefined;
}

/** Decimals may come as text (they can exceed what a JSON number holds); anything not numeric stays as it is. */
function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function numberText(value: unknown, options: Intl.NumberFormatOptions): FieldValueDisplay {
  const number = toNumber(value);
  return text(number === undefined ? String(value) : new Intl.NumberFormat(LOCALE, options).format(number));
}

function currencyText(value: unknown, currencyCode: string | undefined): FieldValueDisplay {
  if (currencyCode === undefined) return numberText(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return numberText(value, { style: 'currency', currency: currencyCode });
}

/** A calendar date has no time zone: it reads the same wherever the person is. */
function dateText(value: string, timeZone: string | undefined): string {
  return DATE_ONLY.test(value) ? formatShortDate(`${value}T00:00:00Z`, 'UTC') : formatShortDate(value, timeZone);
}

function formulaText(field: ReadField, value: unknown, timeZone: string | undefined): FieldValueDisplay {
  switch (field.config['resultType']) {
    case 'NUMBER':
      return numberText(value, { maximumFractionDigits: numberConfig(field, 'decimals') ?? 6 });
    case 'CURRENCY':
      return currencyText(value, undefined);
    case 'DATE':
      return text(dateText(String(value), timeZone));
    default:
      return text(String(value));
  }
}

/** A TABLE column as the ticket reads it (`config.columns`). */
export interface ReadColumn {
  readonly code: string;
  readonly label: string;
  readonly type: string;
  readonly options?: readonly Option[];
  readonly decimals?: number;
}

/** The columns of a TABLE field. */
export function readColumnsOf(field: ReadField): readonly ReadColumn[] {
  const columns = field.config['columns'];
  return Array.isArray(columns) ? (columns as readonly ReadColumn[]) : [];
}

/**
 * A cell of a TABLE as text, formatted like a field of its type: numbers and amounts with their decimals, dates as
 * dates, a list option by its label. A file cell is shown by the caller (its names come from the ticket's files);
 * here it is `undefined`, as is an empty cell.
 */
export function tableCellText(column: ReadColumn, value: unknown, timeZone?: string): string | undefined {
  if (isEmpty(value) || column.type === 'FILE') return undefined;
  switch (column.type) {
    case 'NUMBER':
      return displayText(numberText(value, { maximumFractionDigits: column.decimals ?? 6 }));
    case 'CURRENCY':
      return displayText(currencyText(value, undefined));
    case 'FORMULA':
      return displayText(numberText(value, { maximumFractionDigits: column.decimals ?? 6 }));
    case 'DATE':
      return dateText(String(value), timeZone);
    case 'SELECT':
      return column.options?.find((option) => option.value === String(value))?.label ?? String(value);
    default:
      return String(value);
  }
}

const displayText = (display: FieldValueDisplay): string => (display.kind === 'text' ? display.text : '');
