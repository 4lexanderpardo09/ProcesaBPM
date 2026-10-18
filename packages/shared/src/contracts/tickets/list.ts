import { z } from 'zod';
import { pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';
import { TICKET_VIEWS, ticketStatusSchema } from './schemas.js';

export type TicketView = (typeof TICKET_VIEWS)[number];

/**
 * The filters the ticket inbox shares between its listing and its counts. `search` matches the ticket number,
 * the title or the requester's name; `categoryId` keeps the tickets whose subcategory belongs to that category.
 */
export const ticketFiltersQuerySchema = z.object({
  status: ticketStatusSchema.optional(),
  search: pageQuerySchema.shape.search,
  priorityId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
});
export type TicketFiltersQuery = z.infer<typeof ticketFiltersQuerySchema>;

export const listTicketsQuerySchema = pageQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ view: z.enum(TICKET_VIEWS).default('assigned') })
  .extend(ticketFiltersQuerySchema.shape);
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/** `GET /tickets/counts`: how many tickets each view holds under the same filters as the listing. */
export type TicketCountsResponse = Readonly<Record<TicketView, number>>;

const countSchema = z.number().int().min(0);

/** Parses `TicketCountsResponse` (for the web client). */
export const ticketCountsResponseSchema = z.object({
  assigned: countSchema,
  created: countSchema,
  observed: countSchema,
  all: countSchema,
}) satisfies z.ZodType<TicketCountsResponse>;
