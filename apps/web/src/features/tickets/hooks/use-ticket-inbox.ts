import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { ticketCountsQueryOptions, ticketListQueryOptions } from '../api/tickets-api';
import { filtersOf, type InboxParams, type TicketView } from '../lib/inbox-params';

/** The page of tickets the URL asks for, and how many tickets each tab holds with the same filters. */
export function useTicketInbox(params: InboxParams) {
  const client = useApiClient();
  const list = useQuery(ticketListQueryOptions(client, params));
  const counts = useQuery(ticketCountsQueryOptions(client, filtersOf(params)));
  const countOf = (view: TicketView): number | undefined => counts.data?.[view];
  return { list, countOf };
}
