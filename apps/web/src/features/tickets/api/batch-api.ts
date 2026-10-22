import { type BatchTransitionRequest, batchTransitionResponseSchema, ticketBatchGroupsResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { ticketQueryKeys } from './tickets-api';

/** Under the tickets key: any action on a ticket reads the groups again. */
export function ticketBatchGroupsQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: [...ticketQueryKeys.all, 'batches'] as const,
    queryFn: ({ signal }) => client.request('/ticket-batches', { schema: ticketBatchGroupsResponseSchema, signal }),
  });
}

/** One decision for several tickets; the answer says, ticket by ticket, which moved and why the others did not. */
export function runTicketBatch(client: HttpClient, body: BatchTransitionRequest) {
  return client.request('/ticket-batches/transition', { method: 'POST', body, schema: batchTransitionResponseSchema });
}
