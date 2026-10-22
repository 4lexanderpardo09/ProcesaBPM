import type { ExportValueFormat } from '@procesabpm/shared';

const NUMERIC_FORMATS: ReadonlySet<ExportValueFormat> = new Set(['INTEGER', 'INTEGER_OR_EMPTY', 'DECIMAL_2']);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export const isNumericFormat = (format: ExportValueFormat | null): boolean => format !== null && NUMERIC_FORMATS.has(format);

/**
 * A number as people write it here: "$ 1.234.567,89", "1.234.567", "1234567.89" or "1234567". A dot followed by
 * groups of three digits is a thousands separator; a comma is the decimal one. `null` when there is no number.
 */
export function parseLocaleNumber(input: string): number | null {
  let text = input.replace(/[^\d.,-]/g, '').trim();
  if (text === '') return null;
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) text = text.replace(/\./g, '').replace(',', '.');
  else if (hasComma) text = text.replace(',', '.');
  else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** `dd/mm/yyyy` of a date (`YYYY-MM-DD…` keeps its own day, never shifted by a time zone); anything else as it is. */
export function dayMonthYear(input: string): string {
  const match = ISO_DATE.exec(input.trim());
  return match === null ? input.trim() : `${match[3]!}/${match[2]!}/${match[1]!}`;
}

/** A column's format applied to its raw value. Conservative: what does not parse is left as it was (trimmed). */
export function formatValue(raw: string, format: ExportValueFormat | null): string {
  switch (format) {
    case 'UPPER':
      return raw.trim().toUpperCase();
    case 'INTEGER': {
      const value = parseLocaleNumber(raw);
      return value === null ? raw.trim() : String(Math.round(value));
    }
    case 'INTEGER_OR_EMPTY': {
      const value = parseLocaleNumber(raw);
      return value === null || Math.round(value) === 0 ? '' : String(Math.round(value));
    }
    case 'DECIMAL_2': {
      const value = parseLocaleNumber(raw);
      return value === null ? raw.trim() : value.toFixed(2);
    }
    case 'DATE_DMY':
      return dayMonthYear(raw);
    default:
      return raw.trim();
  }
}
