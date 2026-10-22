import {
  errorSubtypeResponseSchema,
  errorTypeResponseSchema,
  incidentMutationResponseSchema,
  pageResponseSchema,
  type ReopenTicketRequest,
  type ReportTicketErrorRequest,
  type TicketCandidatesQuery,
  ticketCandidatesResponseSchema,
  ticketMutationResponseSchema,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { ticketQueryKeys } from './tickets-api';

const ticketUrl = (ticketId: string) => `/tickets/${encodeURIComponent(ticketId)}`;

/** The most the API returns per page; a catalog of error types is far shorter than that. */
const CATALOG_PAGE_SIZE = 100;

export const errorTypeQueryKeys = {
  all: ['error-types'] as const,
  subtypes: (errorTypeId: string) => [...errorTypeQueryKeys.all, errorTypeId, 'subtypes'] as const,
};

/** Who the current step can go to (`reassign`) or who can take an incident (`incident`), by name. */
export function ticketCandidatesQueryOptions(client: HttpClient, ticketId: string, purpose: TicketCandidatesQuery['for']) {
  return queryOptions({
    queryKey: [...ticketQueryKeys.detail(ticketId), 'candidates', purpose] as const,
    queryFn: ({ signal }) => client.request(`${ticketUrl(ticketId)}/candidates?for=${purpose}`, { schema: ticketCandidatesResponseSchema, signal }),
  });
}

export function takeTicket(client: HttpClient, ticketId: string, visitId: string) {
  return client.request(`${ticketUrl(ticketId)}/take`, { method: 'POST', body: { visitId }, schema: ticketMutationResponseSchema });
}

export function reassignTicket(client: HttpClient, ticketId: string, body: { visitId: string; toUserId: string; comment?: string }) {
  return client.request(`${ticketUrl(ticketId)}/reassign`, { method: 'POST', body, schema: ticketMutationResponseSchema });
}

export function closeTicket(client: HttpClient, ticketId: string, body: { visitId: string; comment?: string }) {
  return client.request(`${ticketUrl(ticketId)}/close`, { method: 'POST', body: { ...body, values: {}, attachments: [] }, schema: ticketMutationResponseSchema });
}

export function openIncident(client: HttpClient, ticketId: string, body: { visitId: string; assignedToId: string; description: string }) {
  return client.request(`${ticketUrl(ticketId)}/incidents`, { method: 'POST', body, schema: incidentMutationResponseSchema });
}

export function resolveIncident(client: HttpClient, ticketId: string, incidentId: string, resolution: string) {
  return client.request(`${ticketUrl(ticketId)}/incidents/${encodeURIComponent(incidentId)}/resolve`, { method: 'POST', body: { resolution }, schema: incidentMutationResponseSchema });
}

/** Answers the current step with one of its decisions, the values captured on it and an optional comment. */
export function transitionTicket(client: HttpClient, ticketId: string, body: { transitionId: string; visitId: string; values: Record<string, unknown>; comment?: string; assigneeId?: string }) {
  return client.request(`${ticketUrl(ticketId)}/transition`, { method: 'POST', body: { ...body, attachments: [] }, schema: ticketMutationResponseSchema });
}

/** Signs or rejects the caller's own pending signature on a parallel step; `assigneeId` when the step that follows asks for one. */
export function answerParallelTask(client: HttpClient, ticketId: string, answer: 'sign' | 'reject', body: { visitId: string; comment?: string; assigneeId?: string }) {
  return client.request(`${ticketUrl(ticketId)}/parallel-tasks/${answer}`, { method: 'POST', body, schema: ticketMutationResponseSchema });
}

/** Reopens a closed ticket on its last step, with whoever held it, filing an error of a reopening type. */
export function reopenTicket(client: HttpClient, ticketId: string, body: ReopenTicketRequest) {
  return client.request(`${ticketUrl(ticketId)}/reopen`, { method: 'POST', body, schema: ticketMutationResponseSchema });
}

export function reportTicketError(client: HttpClient, ticketId: string, body: ReportTicketErrorRequest) {
  return client.request(`${ticketUrl(ticketId)}/errors`, { method: 'POST', body, schema: ticketMutationResponseSchema });
}

/** The active error types that can be reported on an open ticket (the reopening ones are for reopening). */
export function reportableErrorTypesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: errorTypeQueryKeys.all,
    queryFn: ({ signal }) => client.request(`/error-types?pageSize=${CATALOG_PAGE_SIZE}`, { schema: pageResponseSchema(errorTypeResponseSchema), signal }),
    select: (page) => page.items.filter((type) => !type.isReopening && type.isActive),
  });
}

/** The active error types a reopening can be filed under. */
export function reopeningErrorTypesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: errorTypeQueryKeys.all,
    queryFn: ({ signal }) => client.request(`/error-types?pageSize=${CATALOG_PAGE_SIZE}`, { schema: pageResponseSchema(errorTypeResponseSchema), signal }),
    select: (page) => page.items.filter((type) => type.isReopening && type.isActive),
  });
}

/** The active subtypes of an error type (optional detail of the reopening). */
export function errorSubtypesQueryOptions(client: HttpClient, errorTypeId: string) {
  return queryOptions({
    queryKey: errorTypeQueryKeys.subtypes(errorTypeId),
    queryFn: ({ signal }) => client.request(`/error-types/${encodeURIComponent(errorTypeId)}/subtypes?pageSize=${CATALOG_PAGE_SIZE}`, { schema: pageResponseSchema(errorSubtypeResponseSchema), signal }),
    select: (page) => page.items.filter((subtype) => subtype.isActive),
  });
}
