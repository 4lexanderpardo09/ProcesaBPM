const MIN_FRACTION_WIDTH = 20;

export type ColumnWidth = { readonly pt: number } | { readonly fr: number };

/** Fixed columns take their points; the rest share what is left by `fr` (at least 20 pt each). Too wide → everything shrinks in proportion. */
export function columnWidths(columns: readonly ColumnWidth[], total: number): number[] {
  const fixed = columns.reduce((sum, column) => sum + ('pt' in column ? column.pt : 0), 0);
  const fractions = columns.reduce((sum, column) => sum + ('fr' in column ? column.fr : 0), 0);
  const remaining = Math.max(0, total - fixed);
  const widths = columns.map((column) => ('pt' in column ? column.pt : Math.max(MIN_FRACTION_WIDTH, fractions === 0 ? 0 : (remaining * column.fr) / fractions)));
  const sum = widths.reduce((a, b) => a + b, 0);
  return sum > total ? widths.map((width) => (width * total) / sum) : widths;
}
