import { availableCatalogResponseSchema, type CreateTicketRequest, creationFormResponseSchema, pageResponseSchema, priorityResponseSchema, ticketMutationResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

/** The most the API returns per page; an organization has a handful of priorities. */
const PRIORITIES_PAGE_SIZE = 100;

export const newTicketQueryKeys = {
  catalog: (companyId: string) => ['catalog', 'available', companyId] as const,
  creationForm: (subcategoryId: string, companyId: string) => ['subcategories', subcategoryId, 'creation-form', companyId] as const,
  priorities: ['priorities'] as const,
};

/** The categories and subcategories the person may open tickets of, for that company. */
export function availableCatalogQueryOptions(client: HttpClient, companyId: string) {
  return queryOptions({
    queryKey: newTicketQueryKeys.catalog(companyId),
    queryFn: ({ signal }) => client.request(`/catalog/available?companyId=${encodeURIComponent(companyId)}`, { schema: availableCatalogResponseSchema, signal }),
  });
}

/** What creating a ticket of the subcategory asks: the START blocks the person may use, with their fields. */
export function creationFormQueryOptions(client: HttpClient, subcategoryId: string, companyId: string) {
  return queryOptions({
    queryKey: newTicketQueryKeys.creationForm(subcategoryId, companyId),
    queryFn: ({ signal }) => client.request(`/subcategories/${encodeURIComponent(subcategoryId)}/creation-form?companyId=${encodeURIComponent(companyId)}`, { schema: creationFormResponseSchema, signal }),
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
