import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { ticketDetailQueryOptions, ticketDocumentsQueryOptions, ticketFormQueryOptions, ticketTimelineQueryOptions } from '../api/ticket-detail-api';

/** The ticket and, side by side, its current step and fields, its activity and its attachments. */
export function useTicketDetail(ticketId: string) {
  const client = useApiClient();
  return {
    detail: useQuery(ticketDetailQueryOptions(client, ticketId)),
    form: useQuery(ticketFormQueryOptions(client, ticketId)),
    timeline: useQuery(ticketTimelineQueryOptions(client, ticketId)),
    documents: useQuery(ticketDocumentsQueryOptions(client, ticketId)),
  };
}
