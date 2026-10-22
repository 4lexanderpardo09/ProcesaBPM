import { TICKET_VIEWS, ticketStatusSchema } from '@procesabpm/shared';
import type { z } from 'zod';

export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/** The tabs in their order; the first one is where the inbox opens. */
export const INBOX_VIEWS: readonly TicketView[] = ['assigned', 'created', 'observed', 'all'];
export const TICKET_STATUSES: readonly TicketStatus[] = ticketStatusSchema.options;

const DEFAULT_VIEW: TicketView = 'assigned';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The API takes a search of 1 to 100 characters. */
const SEARCH_MAX = 100;

/** The filters that pick one record by id: their key, their name in the inbox URL and in the API query. */
const ID_FILTERS = [
  { key: 'priorityId', url: 'priority' },
  { key: 'categoryId', url: 'category' },
  { key: 'subcategoryId', url: 'subcategory' },
  { key: 'companyId', url: 'company' },
  { key: 'siteId', url: 'site' },
  { key: 'creatorId', url: 'requester' },
  { key: 'assigneeId', url: 'assignee' },
  { key: 'tagId', url: 'tag' },
] as const;
type IdFilter = (typeof ID_FILTERS)[number]['key'];

/** The filters the listing and the tab counts share. */
export type InboxFilters = { readonly [K in IdFilter]: string | undefined } & {
  readonly status: TicketStatus | undefined;
  /** The ticket number, its title or the requester's name. */
  readonly search: string;
  /** Local dates (`YYYY-MM-DD`), both included: the API gets the instants of the person's own days. */
  readonly createdFrom: string | undefined;
  readonly createdTo: string | undefined;
};

export interface InboxParams extends InboxFilters {
  readonly view: TicketView;
  readonly page: number;
}

export const NO_FILTERS: InboxFilters = {
  status: undefined,
  search: '',
  ...(Object.fromEntries(ID_FILTERS.map(({ key }) => [key, undefined])) as { [K in IdFilter]: undefined }),
  createdFrom: undefined,
  createdTo: undefined,
};

/** The filters past the first row (search, status, priority, category and company): they open folded. */
export const MORE_FILTERS = ['subcategoryId', 'siteId', 'creatorId', 'assigneeId', 'tagId', 'createdFrom', 'createdTo'] as const;

export const filtersOf = (params: InboxParams): InboxFilters => {
  const { view: _view, page: _page, ...filters } = params;
  return filters;
};

export const hasFilters = (filters: InboxFilters): boolean => (Object.keys(NO_FILTERS) as Array<keyof InboxFilters>).some((key) => filters[key] !== NO_FILTERS[key]);

/** What the inbox shows, read from its URL; anything unknown falls back to the default. */
export function readInboxParams(search: URLSearchParams): InboxParams {
  const createdFrom = dateOf(search.get('from'));
  const createdTo = dateOf(search.get('to'));
  return {
    view: oneOf(INBOX_VIEWS, search.get('view')) ?? DEFAULT_VIEW,
    status: oneOf(TICKET_STATUSES, search.get('status')),
    search: (search.get('q') ?? '').trim().slice(0, SEARCH_MAX),
    ...(Object.fromEntries(ID_FILTERS.map(({ key, url }) => [key, idOf(search.get(url))])) as { [K in IdFilter]: string | undefined }),
    createdFrom,
    // A range that ends before it starts is dropped at its end, like any other value the API would refuse.
    createdTo: createdFrom !== undefined && createdTo !== undefined && createdTo < createdFrom ? undefined : createdTo,
    page: pageOf(search.get('page')),
  };
}

/** The URL query for the inbox, leaving the defaults out so the plain `/tickets` stays plain. */
export function writeInboxParams(params: InboxParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.view !== DEFAULT_VIEW) query.set('view', params.view);
  if (params.status !== undefined) query.set('status', params.status);
  if (params.search !== '') query.set('q', params.search);
  for (const { key, url } of ID_FILTERS) {
    const value = params[key];
    if (value !== undefined) query.set(url, value);
  }
  if (params.createdFrom !== undefined) query.set('from', params.createdFrom);
  if (params.createdTo !== undefined) query.set('to', params.createdTo);
  if (params.page > 1) query.set('page', String(params.page));
  return query;
}

/** The API query of the filters: only what is set, the dates as the instants that start the person's days. */
export function filterQuery(filters: InboxFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.status !== undefined) query.set('status', filters.status);
  if (filters.search !== '') query.set('search', filters.search);
  for (const { key } of ID_FILTERS) {
    const value = filters[key];
    if (value !== undefined) query.set(key, value);
  }
  if (filters.createdFrom !== undefined) query.set('createdFrom', startOfLocalDay(filters.createdFrom, 0));
  if (filters.createdTo !== undefined) query.set('createdTo', startOfLocalDay(filters.createdTo, 1));
  return query;
}

/** The instant a local day starts, `days` later (the end of a range is the start of the next day). */
function startOfLocalDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day! + days).toISOString();
}

function dateOf(raw: string | null): string | undefined {
  if (raw === null || !DATE.test(raw)) return undefined;
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(year!, month! - 1, day!);
  return parsed.getFullYear() === year && parsed.getMonth() === month! - 1 && parsed.getDate() === day ? raw : undefined;
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
