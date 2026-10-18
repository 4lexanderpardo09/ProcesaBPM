export interface PageRange {
  readonly from: number;
  readonly to: number;
  readonly pageCount: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/** The items a page shows (1-based, `from` is 0 when there are none) and where it can move. */
export function pageRange(page: number, pageSize: number, total: number): PageRange {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return { from, to: Math.max(to, from), pageCount, hasPrevious: page > 1, hasNext: page < pageCount };
}
