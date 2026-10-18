import { TICKET_VIEWS, ticketStatusSchema } from '@procesabpm/shared';
import type { z } from 'zod';

export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/** The tabs in their order; the first one is where the inbox opens. */
export const INBOX_VIEWS: readonly TicketView[] = ['assigned', 'created', 'observed', 'all'];
export const TICKET_STATUSES: readonly TicketStatus[] = ticketStatusSchema.options;

const DEFAULT_VIEW: TicketView = 'assigned';

export interface InboxParams {
  readonly view: TicketView;
  readonly status: TicketStatus | undefined;
  readonly page: number;
}

/** What the inbox shows, read from its URL; anything unknown falls back to the default. */
export function readInboxParams(search: URLSearchParams): InboxParams {
  return { view: oneOf(INBOX_VIEWS, search.get('view')) ?? DEFAULT_VIEW, status: oneOf(TICKET_STATUSES, search.get('status')), page: pageOf(search.get('page')) };
}

/** The URL query for the inbox, leaving the defaults out so the plain `/tickets` stays plain. */
export function writeInboxParams({ view, status, page }: InboxParams): URLSearchParams {
  const search = new URLSearchParams();
  if (view !== DEFAULT_VIEW) search.set('view', view);
  if (status !== undefined) search.set('status', status);
  if (page > 1) search.set('page', String(page));
  return search;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return values.find((value) => value === raw);
}

function pageOf(raw: string | null): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 1 ? page : 1;
}
