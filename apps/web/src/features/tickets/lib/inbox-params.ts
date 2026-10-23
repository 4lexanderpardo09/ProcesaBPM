import { FIELD_CODE_PATTERN, FIELD_FILTER_OPERATORS, fieldRangeKind, TICKET_VIEWS, ticketStatusSchema } from '@procesabpm/shared';
import type { z } from 'zod';

export type TicketView = (typeof TICKET_VIEWS)[number];
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

/** The tabs in their order; the first one is where the inbox opens. */
export const INBOX_VIEWS: readonly TicketView[] = ['assigned', 'created', 'observed', 'all', 'history', 'reopened', 'errors_reported', 'errors_received'];
export const TICKET_STATUSES: readonly TicketStatus[] = ticketStatusSchema.options;

const DEFAULT_VIEW: TicketView = 'assigned';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The API takes a search of 1 to 100 characters. */
const SEARCH_MAX = 100;

/**
 * How the inbox compares a field: the API's operators plus two of dates the person reads from their own today,
 * "overdue" (before today) and "upcoming" (today and the next `fieldValue` days).
 */
export const FIELD_OPERATORS = [...FIELD_FILTER_OPERATORS, 'overdue', 'upcoming'] as const;
export type FieldOperator = (typeof FIELD_OPERATORS)[number];
/** Values of a field filter are 1 to 200 characters for the API. */
const FIELD_VALUE_MAX = 200;
const UPCOMING_DAYS_MAX = 365;

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
  /** The search also looks in the description and the comments. */
  readonly searchMessages: boolean;
  /** Local dates (`YYYY-MM-DD`), both included: the API gets the instants of the person's own days. */
  readonly createdFrom: string | undefined;
  readonly createdTo: string | undefined;
  /** A field of the form by code, how to compare it and with what; kept as typed, sent only once whole. */
  readonly fieldCode: string | undefined;
  readonly fieldOperator: FieldOperator | undefined;
  readonly fieldValue: string | undefined;
  readonly fieldValueTo: string | undefined;
};

export interface InboxParams extends InboxFilters {
  readonly view: TicketView;
  readonly page: number;
}

export const NO_FILTERS: InboxFilters = {
  status: undefined,
  search: '',
  searchMessages: false,
  ...(Object.fromEntries(ID_FILTERS.map(({ key }) => [key, undefined])) as { [K in IdFilter]: undefined }),
  createdFrom: undefined,
  createdTo: undefined,
  fieldCode: undefined,
  fieldOperator: undefined,
  fieldValue: undefined,
  fieldValueTo: undefined,
};

/** The filters past the first row (search, status, priority, category and company): they open folded. */
export const MORE_FILTERS = ['subcategoryId', 'siteId', 'creatorId', 'assigneeId', 'tagId', 'createdFrom', 'createdTo', 'fieldCode'] as const;

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
    searchMessages: search.get('msgs') === '1',
    ...(Object.fromEntries(ID_FILTERS.map(({ key, url }) => [key, idOf(search.get(url))])) as { [K in IdFilter]: string | undefined }),
    createdFrom,
    // A range that ends before it starts is dropped at its end, like any other value the API would refuse.
    createdTo: createdFrom !== undefined && createdTo !== undefined && createdTo < createdFrom ? undefined : createdTo,
    ...fieldFilterOf(search),
    page: pageOf(search.get('page')),
  };
}

/** The field filter of the URL: a known code first, then its operator, then the values. */
function fieldFilterOf(search: URLSearchParams): Pick<InboxFilters, 'fieldCode' | 'fieldOperator' | 'fieldValue' | 'fieldValueTo'> {
  const code = search.get('field');
  if (code === null || !FIELD_CODE_PATTERN.test(code)) return { fieldCode: undefined, fieldOperator: undefined, fieldValue: undefined, fieldValueTo: undefined };
  const value = (raw: string | null) => (raw === null || raw.trim() === '' ? undefined : raw.trim().slice(0, FIELD_VALUE_MAX));
  return { fieldCode: code, fieldOperator: oneOf(FIELD_OPERATORS, search.get('op')), fieldValue: value(search.get('fv')), fieldValueTo: value(search.get('fv2')) };
}

/** The URL query for the inbox, leaving the defaults out so the plain `/tickets` stays plain. */
export function writeInboxParams(params: InboxParams): URLSearchParams {
  const query = new URLSearchParams();
  if (params.view !== DEFAULT_VIEW) query.set('view', params.view);
  if (params.status !== undefined) query.set('status', params.status);
  if (params.search !== '') query.set('q', params.search);
  if (params.searchMessages) query.set('msgs', '1');
  for (const { key, url } of ID_FILTERS) {
    const value = params[key];
    if (value !== undefined) query.set(url, value);
  }
  if (params.createdFrom !== undefined) query.set('from', params.createdFrom);
  if (params.createdTo !== undefined) query.set('to', params.createdTo);
  if (params.fieldCode !== undefined) query.set('field', params.fieldCode);
  if (params.fieldOperator !== undefined) query.set('op', params.fieldOperator);
  if (params.fieldValue !== undefined) query.set('fv', params.fieldValue);
  if (params.fieldValueTo !== undefined) query.set('fv2', params.fieldValueTo);
  if (params.page > 1) query.set('page', String(params.page));
  return query;
}

/** The API query of the filters: only what is set, the dates as the instants that start the person's days. */
export function filterQuery(filters: InboxFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.status !== undefined) query.set('status', filters.status);
  if (filters.search !== '') query.set('search', filters.search);
  if (filters.search !== '' && filters.searchMessages) query.set('searchMessages', 'true');
  for (const { key } of ID_FILTERS) {
    const value = filters[key];
    if (value !== undefined) query.set(key, value);
  }
  if (filters.createdFrom !== undefined) query.set('createdFrom', startOfLocalDay(filters.createdFrom, 0));
  if (filters.createdTo !== undefined) query.set('createdTo', startOfLocalDay(filters.createdTo, 1));
  const field = apiFieldFilter(filters, new Date());
  if (field !== undefined) for (const [key, value] of Object.entries(field)) if (value !== undefined) query.set(key, value);
  return query;
}

interface ApiFieldFilter {
  readonly fieldCode: string;
  readonly fieldOperator: (typeof FIELD_FILTER_OPERATORS)[number];
  readonly fieldValue?: string | undefined;
  readonly fieldValueTo?: string | undefined;
}

/**
 * The field filter as the API takes it, or `undefined` while it is not whole (a code without its condition, a
 * range without ends): a half-typed filter narrows nothing instead of failing. "Overdue" and "upcoming" become a
 * range of the person's own days.
 */
export function apiFieldFilter(filters: InboxFilters, now: Date): ApiFieldFilter | undefined {
  const { fieldCode, fieldOperator, fieldValue, fieldValueTo } = filters;
  if (fieldCode === undefined || fieldOperator === undefined) return undefined;
  switch (fieldOperator) {
    case 'contains':
    case 'equals':
      return fieldValue === undefined ? undefined : { fieldCode, fieldOperator, fieldValue };
    case 'between':
      return fieldRangeKind(fieldValue, fieldValueTo) === undefined ? undefined : { fieldCode, fieldOperator, fieldValue, fieldValueTo };
    case 'filled':
    case 'empty':
      return { fieldCode, fieldOperator };
    case 'overdue':
      return { fieldCode, fieldOperator: 'between', fieldValueTo: localDay(now, -1) };
    case 'upcoming': {
      const days = Number(fieldValue ?? '');
      if (!Number.isInteger(days) || days < 0 || days > UPCOMING_DAYS_MAX) return undefined;
      return { fieldCode, fieldOperator: 'between', fieldValue: localDay(now, 0), fieldValueTo: localDay(now, days) };
    }
  }
}

/** The person's local day `days` after the one of `now`, as `YYYY-MM-DD`. */
function localDay(now: Date, days: number): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
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
