import { ticketPageResponseSchema } from '@procesabpm/shared';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import type { InboxParams, TicketStatus, TicketView } from '../lib/inbox-params';

export const INBOX_PAGE_SIZE = 25;

interface ListQuery {
  readonly view: TicketView;
  readonly status: TicketStatus | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export const ticketQueryKeys = {
  all: ['tickets'] as const,
  list: (params: InboxParams) => [...ticketQueryKeys.all, 'list', params] as const,
  count: (view: TicketView, status: TicketStatus | undefined) => [...ticketQueryKeys.all, 'count', { view, status }] as const,
  detail: (ticketId: string) => [...ticketQueryKeys.all, 'detail', ticketId] as const,
  form: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'form'] as const,
  timeline: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'timeline'] as const,
  documents: (ticketId: string) => [...ticketQueryKeys.detail(ticketId), 'documents'] as const,
};

function listTickets(client: HttpClient, { view, status, page, pageSize }: ListQuery, signal: AbortSignal) {
  const query = new URLSearchParams({ view, page: String(page), pageSize: String(pageSize) });
  if (status !== undefined) query.set('status', status);
  return client.request(`/tickets?${query.toString()}`, { schema: ticketPageResponseSchema, signal });
}

/** One page of the inbox; the previous page stays on screen while the next one loads. */
export function ticketListQueryOptions(client: HttpClient, params: InboxParams) {
  return queryOptions({
    queryKey: ticketQueryKeys.list(params),
    queryFn: ({ signal }) => listTickets(client, { ...params, pageSize: INBOX_PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  });
}

/** How many tickets a tab holds: the total of a one-item page, until the API has a count endpoint. */
export function ticketCountQueryOptions(client: HttpClient, view: TicketView, status: TicketStatus | undefined) {
  return queryOptions({
    queryKey: ticketQueryKeys.count(view, status),
    queryFn: ({ signal }) => listTickets(client, { view, status, page: 1, pageSize: 1 }, signal),
    select: (page) => page.total,
  });
}
