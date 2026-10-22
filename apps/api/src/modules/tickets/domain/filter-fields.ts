import type { FilterableFieldType, TicketFilterFieldResponse } from '@procesabpm/shared';

export interface FilterableFieldRow {
  readonly code: string;
  readonly label: string;
  readonly type: FilterableFieldType;
  readonly config: unknown;
  readonly dataSource: unknown;
}

/** The fixed options of a `SELECT` that has them; a dataset or preset is not listed here. */
function fixedOptions(row: FilterableFieldRow): TicketFilterFieldResponse['options'] {
  if (row.type !== 'SELECT' || row.dataSource !== null) return null;
  const options = (row.config as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return null;
  return options.flatMap((option: unknown) => {
    const { value, label } = (option ?? {}) as { value?: unknown; label?: unknown };
    return typeof value === 'string' ? [{ value, label: typeof label === 'string' ? label : value }] : [];
  });
}

/**
 * One entry per code, from rows ordered latest published first: the newest version names the field. Sorted by
 * label, so the picker reads like the forms.
 */
export function filterFieldsOf(rows: readonly FilterableFieldRow[]): TicketFilterFieldResponse[] {
  const byCode = new Map<string, TicketFilterFieldResponse>();
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, { code: row.code, label: row.label, type: row.type, options: fixedOptions(row) });
  }
  return [...byCode.values()].sort((left, right) => left.label.localeCompare(right.label, 'es') || left.code.localeCompare(right.code));
}
