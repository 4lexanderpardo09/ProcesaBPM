import { pageResponseSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import type { HttpClient } from '@/shared/api';

export const CATALOG_PAGE_SIZE = 25;

/** Every catalog list lives under this key: a change anywhere reads them again. */
export const catalogQueryKeys = {
  all: ['catalog-admin'] as const,
  list: (path: string, params: Readonly<Record<string, string>>) => [...catalogQueryKeys.all, path, params] as const,
};

export interface CatalogListParams {
  readonly page: number;
  readonly search: string;
  readonly includeInactive: boolean;
  /** Filters of that list, such as `categoryId`. */
  readonly filter?: Readonly<Record<string, string>>;
}

/** One page of a catalog list (`GET /categories`, `/priorities`…), with the API's search and inactive filter. */
export function catalogListQueryOptions<TItem extends z.ZodType>(client: HttpClient, path: string, item: TItem, { page, search, includeInactive, filter = {} }: CatalogListParams) {
  const params: Record<string, string> = { page: String(page), pageSize: String(CATALOG_PAGE_SIZE), includeInactive: String(includeInactive), ...filter };
  if (search !== '') params['search'] = search;
  return queryOptions({
    queryKey: catalogQueryKeys.list(path, params),
    queryFn: ({ signal }) => client.request(`${path}?${new URLSearchParams(params).toString()}`, { schema: pageResponseSchema(item), signal }),
    placeholderData: keepPreviousData,
  });
}

/** Creates (`POST path`) or edits (`PATCH path/:id`) a record and returns it as the API keeps it. */
export function saveCatalogItem<TItem extends z.ZodType>(client: HttpClient, path: string, item: TItem, id: string | undefined, body: Readonly<Record<string, unknown>>) {
  return id === undefined ? client.request(path, { method: 'POST', body, schema: item }) : client.request(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body, schema: item });
}

/** Deactivating hides a record from new tickets without deleting it (what already uses it keeps it). */
export function setCatalogItemActive(client: HttpClient, path: string, id: string, active: boolean) {
  return client.request(`${path}/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' });
}
