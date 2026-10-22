import { availableCatalogResponseSchema, type CreateTicketRequest, creationFormResponseSchema, pageResponseSchema, priorityResponseSchema, ticketMutationResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

/** The most the API returns per page; an organization has a handful of priorities. */
const PRIORITIES_PAGE_SIZE = 100;

export const newTicketQueryKeys = {
  catalog: (companyId: string, requesterId: string) => ['catalog', 'available', companyId, requesterId] as const,
  creationForm: (subcategoryId: string, companyId: string, requesterId: string) => ['subcategories', subcategoryId, 'creation-form', companyId, requesterId] as const,
  priorities: ['priorities'] as const,
};

/** Only what is set, so the caller's own catalog and form keep their plain URLs. */
const forWhom = (companyId: string, requesterId: string): string => {
  const query = new URLSearchParams();
  if (companyId !== '') query.set('companyId', companyId);
  if (requesterId !== '') query.set('requesterId', requesterId);
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
};

/**
 * The categories and subcategories the requester may open tickets of, for that company (all of theirs without one).
 * `requesterId` empty: the caller; someone else's needs `create_for_others`, and the answer also lists their companies.
 */
export function availableCatalogQueryOptions(client: HttpClient, companyId: string, requesterId = '') {
  return queryOptions({
    queryKey: newTicketQueryKeys.catalog(companyId, requesterId),
    queryFn: ({ signal }) => client.request(`/catalog/available${forWhom(companyId, requesterId)}`, { schema: availableCatalogResponseSchema, signal }),
  });
}

/** What creating a ticket of the subcategory asks: the START blocks the requester may use, with their fields. */
export function creationFormQueryOptions(client: HttpClient, subcategoryId: string, companyId: string, requesterId = '') {
  return queryOptions({
    queryKey: newTicketQueryKeys.creationForm(subcategoryId, companyId, requesterId),
    queryFn: ({ signal }) => client.request(`/subcategories/${encodeURIComponent(subcategoryId)}/creation-form${forWhom(companyId, requesterId)}`, { schema: creationFormResponseSchema, signal }),
  });
}

/** The active priorities, in their order. */
export function prioritiesQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: newTicketQueryKeys.priorities,
    queryFn: ({ signal }) => client.request(`/priorities?pageSize=${PRIORITIES_PAGE_SIZE}`, { schema: pageResponseSchema(priorityResponseSchema), signal }),
    select: (page) => page.items.filter((priority) => priority.isActive).sort((left, right) => left.sortOrder - right.sortOrder),
  });
}

export function createTicket(client: HttpClient, body: CreateTicketRequest) {
  return client.request('/tickets', { method: 'POST', body, schema: ticketMutationResponseSchema });
}
