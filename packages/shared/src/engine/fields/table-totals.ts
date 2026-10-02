import { Decimal, DecimalError } from '../money/fixed-decimal.js';
import type { TableColumn } from './normalize-value.js';

/**
 * The total of every column marked `showTotal`, exact (no floats), as plain decimal text. Empty cells count as nothing;
 * a column with no value at all totals `0`. Derived, never stored: it follows the rows. A cell that is not a number
 * (it cannot be: rows are normalized on the way in) makes the column's total absent instead of wrong.
 */
export function tableColumnTotals(config: Readonly<Record<string, unknown>>, rows: unknown): Record<string, string> {
  const columns = ((config.columns as TableColumn[] | undefined) ?? []).filter((column) => column.showTotal === true && (column.type === 'NUMBER' || column.type === 'CURRENCY'));
  if (columns.length === 0 || !Array.isArray(rows)) return {};
  const totals: Record<string, string> = {};
  for (const column of columns) {
    try {
      let total = Decimal.ZERO;
      for (const row of rows as Array<Record<string, unknown>>) {
        const cell = row?.[column.code];
        if (cell !== undefined && cell !== null && cell !== '') total = total.add(Decimal.parse(cell as string | number));
      }
      totals[column.code] = total.toPlainString();
    } catch (error) {
      if (!(error instanceof DecimalError)) throw error;
    }
  }
  return totals;
}
