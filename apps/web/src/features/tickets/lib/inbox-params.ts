import { TICKET_VIEWS, ticketStatusSchema } from '@procesabpm/shared';
import type { z } from 'zod';

export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/** The tabs in their order; the first one is where the inbox opens. */
export const INBOX_VIEWS: readonly TicketView[] = ['assigned', 'created', 'observed', 'all'];
export const TICKET_STATUSES: readonly TicketStatus[] = ticketStatusSchema.options;

const DEFAULT_VIEW: TicketView = 'assigned';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The API takes a search of 1 to 100 characters. */
const SEARCH_MAX = 100;

/** The filters the listing and the tab counts share. */
export interface InboxFilters {
  readonly status: TicketStatus | undefined;
  /** The ticket number, its title or the requester's name. */
  readonly search: string;
  readonly priorityId: string | undefined;
  readonly categoryId: string | undefined;
  readonly companyId: string | undefined;
}

export interface InboxParams extends InboxFilters {
  readonly view: TicketView;
  readonly page: number;
}

export const NO_FILTERS: InboxFilters = { status: undefined, search: '', priorityId: undefined, categoryId: undefined, companyId: undefined };

export const filtersOf = ({ status, search, priorityId, categoryId, companyId }: InboxParams): InboxFilters => ({ status, search, priorityId, categoryId, companyId });

export const hasFilters = (filters: InboxFilters): boolean => filters.status !== undefined || filters.search !== '' || filters.priorityId !== undefined || filters.categoryId !== undefined || filters.companyId !== undefined;

/** What the inbox shows, read from its URL; anything unknown falls back to the default. */
export function readInboxParams(search: URLSearchParams): InboxParams {
  return {
    view: oneOf(INBOX_VIEWS, search.get('view')) ?? DEFAULT_VIEW,
    status: oneOf(TICKET_STATUSES, search.get('status')),
    search: (search.get('q') ?? '').trim().slice(0, SEARCH_MAX),
    priorityId: idOf(search.get('priority')),
    categoryId: idOf(search.get('category')),
    companyId: idOf(search.get('company')),
    page: pageOf(search.get('page')),
  };
}

/** The URL query for the inbox, leaving the defaults out so the plain `/tickets` stays plain. */
export function writeInboxParams({ view, status, search, priorityId, categoryId, companyId, page }: InboxParams): URLSearchParams {
  const query = new URLSearchParams();
  if (view !== DEFAULT_VIEW) query.set('view', view);
  if (status !== undefined) query.set('status', status);
  if (search !== '') query.set('q', search);
  if (priorityId !== undefined) query.set('priority', priorityId);
  if (categoryId !== undefined) query.set('category', categoryId);
  if (companyId !== undefined) query.set('company', companyId);
  if (page > 1) query.set('page', String(page));
  return query;
}

/** The API query of the filters: only what is set. */
export function filterQuery({ status, search, priorityId, categoryId, companyId }: InboxFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (status !== undefined) query.set('status', status);
  if (search !== '') query.set('search', search);
  if (priorityId !== undefined) query.set('priorityId', priorityId);
  if (categoryId !== undefined) query.set('categoryId', categoryId);
  if (companyId !== undefined) query.set('companyId', companyId);
  return query;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return values.find((value) => value === raw);
}

function idOf(raw: string | null): string | undefined {
  return raw !== null && UUID.test(raw) ? raw : undefined;
}

function pageOf(raw: string | null): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 1 ? page : 1;
}
