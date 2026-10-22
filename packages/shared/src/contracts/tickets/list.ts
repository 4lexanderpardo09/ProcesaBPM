import { z } from 'zod';
import { pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';
import { TICKET_VIEWS, ticketStatusSchema } from './schemas.js';

export type TicketView = (typeof TICKET_VIEWS)[number];

/**
 * The filters the ticket inbox shares between its listing and its counts. `search` matches the ticket number,
 * the title or the requester's name; `categoryId` keeps the tickets whose subcategory belongs to that category;
 * `tagId` is one of the caller's own tags (tags are personal); `assigneeId` is whoever holds the ticket now;
 * `createdFrom` and `createdTo` are instants (the client turns the person's dates into them), `createdTo` excluded.
 */
const ticketFiltersObject = z.object({
  status: ticketStatusSchema.optional(),
  search: pageQuerySchema.shape.search,
  priorityId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  subcategoryId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  creatorId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  tagId: uuidSchema.optional(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
});
const datesInOrder = (query: { createdFrom?: string | undefined; createdTo?: string | undefined }) =>
  query.createdFrom === undefined || query.createdTo === undefined || Date.parse(query.createdFrom) < Date.parse(query.createdTo);
const DATES_IN_ORDER = { message: 'createdFrom must be before createdTo', path: ['createdTo'] };

export const ticketFiltersQuerySchema = ticketFiltersObject.refine(datesInOrder, DATES_IN_ORDER);
export type TicketFiltersQuery = z.infer<typeof ticketFiltersQuerySchema>;

export const listTicketsQuerySchema = pageQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({ view: z.enum(TICKET_VIEWS).default('assigned') })
  .extend(ticketFiltersObject.shape)
  .refine(datesInOrder, DATES_IN_ORDER);
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
  history: countSchema,
  reopened: countSchema,
  errors_reported: countSchema,
  errors_received: countSchema,
}) satisfies z.ZodType<TicketCountsResponse>;
