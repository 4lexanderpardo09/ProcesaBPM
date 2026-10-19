import type { FormFieldResponse } from '@procesabpm/shared';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';

const LOCALE = 'es-CO';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** How a field's value reads on the ticket: as text, as a count, or as a reference the API does not name yet. */
export type FieldValueDisplay =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'days'; readonly count: number }
  | { readonly kind: 'rows'; readonly count: number }
  | { readonly kind: 'unnamed' };

interface Option {
  readonly value: string;
  readonly label: string;
}

/** `undefined` when there is nothing to show: no value, or a file (those are listed with the attachments). */
export function fieldValueDisplay(field: FormFieldResponse, value: unknown, timeZone?: string): FieldValueDisplay | undefined {
  if (isEmpty(value) || field.type === 'FILE') return undefined;
  switch (field.type) {
    case 'SELECT':
      return text(optionLabel(field, String(value)));
    case 'MULTI_SELECT':
      return text((Array.isArray(value) ? value : [value]).map((entry) => optionLabel(field, String(entry))).join(', '));
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
    case 'USER':
      return { kind: 'unnamed' };
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

function optionLabel(field: FormFieldResponse, value: string): string {
  const options = field.config['options'];
  if (!Array.isArray(options)) return value;
  return (options as readonly Option[]).find((option) => option.value === value)?.label ?? value;
}

function numberConfig(field: FormFieldResponse, key: string): number | undefined {
  const value = field.config[key];
  return typeof value === 'number' ? value : undefined;
}

function stringConfig(field: FormFieldResponse, key: string): string | undefined {
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

function formulaText(field: FormFieldResponse, value: unknown, timeZone: string | undefined): FieldValueDisplay {
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
