import type { ExportColumn, ExportSeparation } from '@procesabpm/shared';
import { formatValue, isNumericFormat, parseLocaleNumber } from './value-format.js';

/** One file of a cutoff: its lines and which group it is. */
export interface FileGroup<T> {
  /** Stable key of the group ('' = the only file). */
  readonly key: string;
  /** What the screen and the file name show; `null` without separation. */
  readonly label: string | null;
  /** Whose file it is, when separated by a step's responsible. */
  readonly responsibleId: string | null;
  readonly lines: T[];
}

/** Where a line's ticket stands for the step of the separation. */
export interface LineHolder {
  /** The ticket is on that step now. */
  readonly onStep: boolean;
  /** Who holds it there, when someone does. */
  readonly userId: string | null;
}

/**
 * Splits the pending lines into files. A ticket on the responsible's step without a holder yet waits for the next
 * cutoff (`waiting`); one no longer on that step goes in the file "without responsible". Pure: the caller resolves
 * holders, names and cells.
 */
export function separateLines<T>(
  lines: readonly T[],
  separation: ExportSeparation | null,
  help: { readonly holder: (line: T) => LineHolder; readonly nameOf: (userId: string) => string; readonly cell: (line: T, header: string) => string; readonly withoutResponsible: string; readonly blank: string },
): { readonly groups: FileGroup<T>[]; readonly waiting: T[] } {
  if (separation === null) return { groups: lines.length === 0 ? [] : [{ key: '', label: null, responsibleId: null, lines: [...lines] }], waiting: [] };
  const groups = new Map<string, FileGroup<T>>();
  const waiting: T[] = [];
  const add = (key: string, label: string, responsibleId: string | null, line: T) => {
    const group = groups.get(key) ?? { key, label, responsibleId, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  };
  for (const line of lines) {
    if (separation.kind === 'COLUMN') {
      const value = help.cell(line, separation.header).trim();
      add(`column:${value.toUpperCase()}`, value === '' ? help.blank : value, null, line);
      continue;
    }
    const holder = help.holder(line);
    if (holder.onStep && holder.userId === null) waiting.push(line);
    else if (holder.onStep && holder.userId !== null) add(`user:${holder.userId}`, help.nameOf(holder.userId), holder.userId, line);
    else add('none', help.withoutResponsible, null, line);
  }
  return { groups: [...groups.values()], waiting };
}

/** The key of a merge: "1.144.068.817", "1144068817 " and "1144068817" are the same person. */
const mergeKey = (value: string | undefined) => (value ?? '').replace(/[\s.-]/g, '').toUpperCase();

/**
 * Joins the rows with the same value in the `by` column: numeric columns (INTEGER, INTEGER_OR_EMPTY, DECIMAL_2) add up
 * in their own format, the others keep their first non-empty value. Rows without a key stay alone; the order is that
 * of each key's first row.
 */
export function mergeRows(columns: readonly ExportColumn[], rows: readonly Record<string, string>[], by: string): Record<string, string>[] {
  const order: Record<string, string>[][] = [];
  const byKey = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const key = mergeKey(row[by]);
    if (key === '') {
      order.push([row]);
      continue;
    }
    let group = byKey.get(key);
    if (group === undefined) {
      group = [];
      byKey.set(key, group);
      order.push(group);
    }
    group.push(row);
  }
  return order.map((group) => {
    if (group.length === 1) return group[0]!;
    const merged: Record<string, string> = { ...group[0]! };
    for (const column of columns) {
      if (isNumericFormat(column.format)) {
        const total = group.reduce((sum, row) => sum + (parseLocaleNumber(row[column.header] ?? '') ?? 0), 0);
        merged[column.header] = formatValue(String(total), column.format);
      } else {
        merged[column.header] = group.map((row) => row[column.header] ?? '').find((value) => value.trim() !== '') ?? '';
      }
    }
    return merged;
  });
}

/** What only the file knows: the row number (SEQUENCE) and the cutoff date (CUTOFF_DATE, `dd/mm/yyyy`). */
export function fillFileColumns(columns: readonly ExportColumn[], rows: readonly Record<string, string>[], cutoffDate: string): Record<string, string>[] {
  return rows.map((row, index) => {
    const filled = { ...row };
    for (const column of columns) {
      if (column.sourceType === 'SEQUENCE') filled[column.header] = String(index + 1);
      if (column.sourceType === 'CUTOFF_DATE') filled[column.header] = formatValue(cutoffDate, column.format ?? 'DATE_DMY');
    }
    return filled;
  });
}

/** A CSV the way the receiving systems read it: CRLF lines, UTF-8, quotes only where a cell needs them. */
export function toCsv(headers: readonly string[], rows: readonly Record<string, string>[], delimiter: string): Buffer {
  const cell = (value: string) => (value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r') ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [headers.map(cell).join(delimiter), ...rows.map((row) => headers.map((header) => cell(row[header] ?? '')).join(delimiter))];
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf-8');
}
