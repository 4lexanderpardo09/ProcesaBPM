import type { Page, PageQuery } from '@procesabpm/shared';

export function pageWindow(query: PageQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** The filter shared by every listing of a record with a `name` and an `isActive` flag. */
export function nameFilter(query: PageQuery): { isActive?: true; name?: { contains: string; mode: 'insensitive' } } {
  return {
    ...(query.includeInactive ? {} : { isActive: true as const }),
    ...(query.search === undefined ? {} : { name: { contains: query.search, mode: 'insensitive' as const } }),
  };
}

export function toPage<Row, Item>(rows: readonly Row[], total: number, query: PageQuery, map: (row: Row) => Item): Page<Item> {
  return { items: rows.map(map), page: query.page, pageSize: query.pageSize, total };
}
