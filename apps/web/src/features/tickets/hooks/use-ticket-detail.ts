import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { ticketDetailQueryOptions, ticketDocumentsQueryOptions, ticketFlowQueryOptions, ticketFormQueryOptions, ticketStepFilesQueryOptions, ticketTimelineQueryOptions } from '../api/ticket-detail-api';

/** The ticket and, side by side, its fields, its progress through the workflow, its activity, its attachments and the support files of its step. */
export function useTicketDetail(ticketId: string) {
  const client = useApiClient();
  return {
    detail: useQuery(ticketDetailQueryOptions(client, ticketId)),
    form: useQuery(ticketFormQueryOptions(client, ticketId)),
    timeline: useQuery(ticketTimelineQueryOptions(client, ticketId)),
    documents: useQuery(ticketDocumentsQueryOptions(client, ticketId)),
    flow: useQuery(ticketFlowQueryOptions(client, ticketId)),
    stepFiles: useQuery(ticketStepFilesQueryOptions(client, ticketId)),
  };
}
