import { type FieldDocument, formatDate, type PdfValue, toScaledInteger } from '@procesabpm/shared';
import { documentsEs as es } from '../i18n/es.js';
import type { NameLookups } from './render-facts.js';

interface Option {
  readonly value?: unknown;
  readonly label?: unknown;
}

const optionsOf = (field: Pick<FieldDocument, 'config'>): Option[] => (Array.isArray(field.config.options) ? (field.config.options as Option[]) : []);
const labelOf = (field: Pick<FieldDocument, 'config'>, value: unknown): string => String(optionsOf(field).find((option) => option.value === value)?.label ?? value);

export interface DisplayOptions {
  readonly timeZone: string;
  readonly currencyCode: string;
}

/**
 * What an expression sees for `{{field.CODE}}`: dates and numbers stay typed (so formatters apply), lists become their
 * labels and ids become names. A value the field cannot hold (it changed type) is shown as plain text.
 */
export function fieldValue(field: Pick<FieldDocument, 'type' | 'config'>, raw: unknown, names: NameLookups): PdfValue {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (field.type) {
    case 'SELECT':
      return labelOf(field, raw);
    case 'MULTI_SELECT':
      return Array.isArray(raw) ? raw.map((value) => labelOf(field, value)).join(', ') : String(raw);
    case 'SITE':
      return typeof raw === 'string' ? (names.sites.get(raw) ?? '') : null;
    case 'USER':
      return typeof raw === 'string' ? (names.users.get(raw) ?? '') : null;
    case 'FILE':
      return Array.isArray(raw) ? es.files(raw.flatMap((id) => (typeof id === 'string' && names.files.has(id) ? [names.files.get(id)!] : []))) : null;
    case 'TABLE':
      return Array.isArray(raw) ? es.rows(raw.length) : null;
    case 'DATETIME':
      return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : String(raw);
    case 'NUMBER':
    case 'DAYS':
    case 'CURRENCY':
      return typeof raw === 'number' || typeof raw === 'string' ? raw : String(raw);
    case 'DATE':
    default:
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : String(raw);
  }
}

/** Text for the "all fields" block: the same value, formatted for reading. */
export function fieldText(field: Pick<FieldDocument, 'type' | 'config'>, raw: unknown, names: NameLookups, options: DisplayOptions): string {
  const value = fieldValue(field, raw, names);
  if (value === null) return '';
  if (value instanceof Date) return formatDate(value, 'dd/MM/yyyy HH:mm', options.timeZone);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (field.type === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && (field.type === 'NUMBER' || field.type === 'CURRENCY' || field.type === 'DAYS') ? Number(value) : Number.NaN;
  if (!Number.isNaN(number)) {
    if (field.type === 'CURRENCY') return new Intl.NumberFormat('es-CO', { style: 'currency', currency: typeof field.config.currencyCode === 'string' ? field.config.currencyCode : options.currencyCode }).format(number);
    return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 }).format(number);
  }
  return String(value);
}

/** Adds up a column of a table without floating point: `null` when no cell holds a number. */
export function sumColumn(cells: readonly unknown[], decimals: number): string | null {
  const scaled = cells.flatMap((cell) => {
    const parsed = typeof cell === 'number' || typeof cell === 'string' ? toScaledInteger(cell) : undefined;
    return parsed === undefined ? [] : [parsed];
  });
  if (scaled.length === 0) return null;
  const total = scaled.reduce((sum, value) => sum + value, 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(7, '0');
  const whole = digits.slice(0, -6);
  const fraction = digits.slice(-6).slice(0, Math.max(decimals, 0));
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}
