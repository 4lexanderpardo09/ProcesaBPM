import {
  incidentMutationResponseSchema,
  type TicketCandidatesQuery,
  ticketCandidatesResponseSchema,
  ticketMutationResponseSchema,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { ticketQueryKeys } from './tickets-api';

const ticketUrl = (ticketId: string) => `/tickets/${encodeURIComponent(ticketId)}`;

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
export function transitionTicket(client: HttpClient, ticketId: string, body: { transitionId: string; visitId: string; values: Record<string, unknown>; comment?: string }) {
  return client.request(`${ticketUrl(ticketId)}/transition`, { method: 'POST', body: { ...body, attachments: [] }, schema: ticketMutationResponseSchema });
}
