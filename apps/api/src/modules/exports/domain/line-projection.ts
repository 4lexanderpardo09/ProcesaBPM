import { type ExportColumn, type ExportFilterRule, parseTableSumReference } from '@procesabpm/shared';
import { formatValue, parseLocaleNumber } from './value-format.js';

/** What a line is built from: the ticket's values and the few facts about it a column can name. */
export interface LineSource {
  /** The ticket's values by field code (tables as arrays of row objects). */
  readonly values: Readonly<Record<string, unknown>>;
  readonly companyName: string;
  readonly requester: { readonly firstName: string; readonly lastName: string; readonly email: string; readonly documentNumber: string | null };
  /** `YYYY-MM-DD` in the company's time zone. */
  readonly ticketDate: string;
  /** Translation tables by catalog name, keys in lower case. */
  readonly catalogs: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The result of each FORMULA column by header, already computed (empty when it failed). */
  readonly formulas: ReadonlyMap<string, string>;
}

/** The text a value takes in a file: numbers and booleans as they are, tables and objects as nothing. */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(', ');
  return '';
}

/** A number a cell or a field holds; anything else counts as nothing. */
const amountOf = (value: unknown): number => (typeof value === 'number' ? value : (parseLocaleNumber(textOf(value)) ?? 0));

/**
 * The sum a TABLE_SUM reference names (`parseTableSumReference`): columns of table fields, only the rows that pass a
 * part's filter (compared without case or outer spaces, like the help desk's pockets), plus whole number fields.
 * A malformed reference sums nothing.
 */
export function tableSum(values: Readonly<Record<string, unknown>>, reference: string): number {
  const parts = parseTableSumReference(reference) ?? [];
  let total = 0;
  for (const part of parts) {
    const value = values[part.field];
    if (part.column === null) {
      if (!Array.isArray(value)) total += amountOf(value);
      continue;
    }
    if (!Array.isArray(value)) continue;
    const wanted = part.filter === null ? null : new Set(part.filter.values.map((option) => option.trim().toLowerCase()));
    for (const row of value) {
      if (typeof row !== 'object' || row === null) continue;
      const cells = row as Record<string, unknown>;
      if (wanted !== null && part.filter !== null && !wanted.has(textOf(cells[part.filter.column]).trim().toLowerCase())) continue;
      total += amountOf(cells[part.column]);
    }
  }
  return total;
}

function requesterAttribute(source: LineSource, attribute: string): string {
  const { firstName, lastName, email, documentNumber } = source.requester;
  switch (attribute) {
    case 'FIRST_NAME':
      return firstName;
    case 'LAST_NAME':
      return lastName;
    case 'FULL_NAME':
      return `${firstName} ${lastName}`.trim();
    case 'EMAIL':
      return email;
    case 'DOCUMENT_NUMBER':
      return documentNumber ?? '';
    default:
      return '';
  }
}

/**
 * The cell of one column for a ticket. SEQUENCE and CUTOFF_DATE belong to the file, not to the ticket: they stay
 * empty here and the cutoff fills them in.
 */
export function resolveCell(column: ExportColumn, source: LineSource): string {
  const ref = column.sourceRef ?? '';
  let raw: string;
  switch (column.sourceType) {
    case 'FIELD':
    case 'DERIVED':
      raw = textOf(source.values[ref]);
      break;
    case 'CONSTANT':
      raw = ref;
      break;
    case 'COMPANY':
      raw = source.companyName;
      break;
    case 'REQUESTER':
      raw = requesterAttribute(source, ref);
      break;
    case 'TABLE_SUM':
      raw = String(tableSum(source.values, ref));
      break;
    case 'CATALOG': {
      const [catalog, field] = ref.split(':');
      const input = textOf(source.values[field ?? '']).trim();
      raw = source.catalogs.get(catalog ?? '')?.get(input.toLowerCase()) ?? input;
      break;
    }
    case 'TICKET_DATE':
      raw = source.ticketDate;
      break;
    case 'FORMULA':
      raw = source.formulas.get(column.header) ?? '';
      break;
    default:
      return '';
  }
  return formatValue(raw, column.format);
}

/** The row of the file for one ticket, by header. */
export function projectLine(columns: readonly ExportColumn[], source: LineSource): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column.header, resolveCell(column, source)]));
}

/** Whether a ticket goes in the export: every rule holds, comparing without case and outer spaces. */
export function passesFilter(rules: readonly ExportFilterRule[], values: Readonly<Record<string, unknown>>): boolean {
  return rules.every((rule) => {
    const value = textOf(values[rule.fieldCode]).trim().toLowerCase();
    const target = rule.value.trim().toLowerCase();
    switch (rule.operator) {
      case 'EQUALS':
        return value === target;
      case 'NOT_EQUALS':
        return value !== target;
      case 'STARTS_WITH':
        return value.startsWith(target);
      case 'CONTAINS':
        return value.includes(target);
      case 'IN_LIST':
        return target
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '')
          .includes(value);
    }
  });
}
