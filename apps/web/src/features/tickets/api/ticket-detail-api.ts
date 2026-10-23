import {
  commentTicketResponseSchema,
  downloadUrlResponseSchema,
  ticketDetailResponseSchema,
  ticketDocumentJobsResponseSchema,
  ticketDocumentResponseSchema,
  ticketFlowResponseSchema,
  ticketFormResponseSchema,
  ticketStepFilesResponseSchema,
  ticketTimelineResponseSchema,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { ticketQueryKeys } from './tickets-api';

const ticketDocumentsResponseSchema = z.array(ticketDocumentResponseSchema);

const ticketUrl = (ticketId: string) => `/tickets/${encodeURIComponent(ticketId)}`;

export function ticketDetailQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.detail(ticketId),
    queryFn: ({ signal }) => client.request(ticketUrl(ticketId), { schema: ticketDetailResponseSchema, signal }),
  });
}

/** The current step (its name) and every field of the version (to label the values). */
export function ticketFormQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.form(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/form`, { schema: ticketFormResponseSchema, signal }),
  });
}

export function ticketTimelineQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.timeline(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/timeline`, { schema: ticketTimelineResponseSchema, signal }),
  });
}

export function ticketDocumentsQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.documents(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/documents`, { schema: ticketDocumentsResponseSchema, signal }),
  });
}

/** The support files of the step the ticket is on (a guide, a format to fill). */
export function ticketStepFilesQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.stepFiles(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/step-files`, { schema: ticketStepFilesResponseSchema, signal }),
  });
}

/** How often the documents being drawn are asked about again. */
export const DOCUMENT_JOBS_POLL_MS = 5000;

/** The documents the workflow draws for the ticket and whether one is being drawn or failed; asked again while one is being drawn. */
export function ticketDocumentJobsQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.documentJobs(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/document-jobs`, { schema: ticketDocumentJobsResponseSchema, signal }),
    refetchInterval: (query) => (query.state.data?.documents.some((document) => document.state === 'GENERATING') === true ? DOCUMENT_JOBS_POLL_MS : false),
  });
}

/** Draws a document of the ticket again, with its current data; it arrives as a new version. */
export function regenerateTicketDocument(client: HttpClient, ticketId: string, workflowDocumentId: string) {
  return client.request(`${ticketUrl(ticketId)}/document-jobs`, { method: 'POST', body: { workflowDocumentId }, schema: ticketDocumentJobsResponseSchema });
}

/** The graph of the ticket's workflow version and how far the ticket got, for the "Avance del flujo" diagram. */
export function ticketFlowQueryOptions(client: HttpClient, ticketId: string) {
  return queryOptions({
    queryKey: ticketQueryKeys.flow(ticketId),
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/flow`, { schema: ticketFlowResponseSchema, signal }),
  });
}

export function commentOnTicket(client: HttpClient, ticketId: string, commentHtml: string) {
  return client.request(`${ticketUrl(ticketId)}/comments`, { method: 'POST', body: { comment: commentHtml }, schema: commentTicketResponseSchema });
}

/** A short-lived link to the stored file; asked for at the moment of downloading. */
export function ticketFileDownloadUrl(client: HttpClient, ticketId: string, fileId: string) {
  return client.request(`${ticketUrl(ticketId)}/files/${encodeURIComponent(fileId)}/download-url`, { schema: downloadUrlResponseSchema });
}
