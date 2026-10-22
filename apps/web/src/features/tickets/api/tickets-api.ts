import { ticketCountsResponseSchema, ticketPageResponseSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { filterQuery, filtersOf, type InboxFilters, type InboxParams } from '../lib/inbox-params';

export const INBOX_PAGE_SIZE = 25;

export const ticketQueryKeys = {
  all: ['tickets'] as const,
  list: (params: InboxParams) => [...ticketQueryKeys.all, 'list', params] as const,
  counts: (filters: InboxFilters) => [...ticketQueryKeys.all, 'counts', filters] as const,
  detail: (ticketId: string) => [...ticketQueryKeys.all, 'detail', ticketId] as const,
  form: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'form'] as const,
  timeline: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'timeline'] as const,
  documents: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'documents'] as const,
  flow: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'flow'] as const,
};

/** One page of the inbox; the previous page stays on screen while the next one loads. */
export function ticketListQueryOptions(client: HttpClient, params: InboxParams) {
  const query = filterQuery(filtersOf(params));
  query.set('view', params.view);
  query.set('page', String(params.page));
  query.set('pageSize', String(INBOX_PAGE_SIZE));
  return queryOptions({
    queryKey: ticketQueryKeys.list(params),
    queryFn: ({ signal }) => client.request(`/tickets?${query.toString()}`, { schema: ticketPageResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });
}

/** How many tickets each tab holds under the same filters, in one request. */
export function ticketCountsQueryOptions(client: HttpClient, filters: InboxFilters) {
  const query = filterQuery(filters).toString();
  return queryOptions({
    queryKey: ticketQueryKeys.counts(filters),
    queryFn: ({ signal }) => client.request(`/tickets/counts${query === '' ? '' : `?${query}`}`, { schema: ticketCountsResponseSchema, signal }),
    placeholderData: keepPreviousData,
  });
}
