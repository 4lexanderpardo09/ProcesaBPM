import { useQueries, useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { ticketCountQueryOptions, ticketListQueryOptions } from '../api/tickets-api';
import { INBOX_VIEWS, type InboxParams, type TicketView } from '../lib/inbox-params';

/** The page of tickets the URL asks for, and how many tickets each tab holds with the same status filter. */
export function useTicketInbox(params: InboxParams) {
  const client = useApiClient();
  const list = useQuery(ticketListQueryOptions(client, params));
  const counts = useQueries({ queries: INBOX_VIEWS.map((view) => ticketCountQueryOptions(client, view, params.status)) });
  const countOf = (view: TicketView): number | undefined => counts[INBOX_VIEWS.indexOf(view)]?.data;
  return { list, countOf };
}
