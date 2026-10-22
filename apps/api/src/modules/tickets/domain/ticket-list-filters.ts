import { type FieldFilterOperator, fieldRangeKind, type TicketFiltersQuery, type TicketView } from '@procesabpm/shared';
import { escapeLike } from '../../../common/crud/like-pattern.js';
import type { Condition, SubjectContext } from '../../authorization/domain/subject-registry.js';
import { createdBy, observedBy } from './ticket-subject.js';

/** Up to 18 digits always fits a ticket number (`bigint`); an optional `#` is how people often write one. */
const TICKET_NUMBER = /^#?(\d{1,18})$/;

/** Case-insensitive `contains` with the text's `%`, `_` and `\` taken literally. */
const insensitive = (text: string) => ({ contains: escapeLike(text), mode: 'insensitive' as const });

/** The ticket number the text names, if it is one. */
export function ticketNumberOf(search: string): bigint | undefined {
  const digits = TICKET_NUMBER.exec(search)?.[1];
  return digits === undefined ? undefined : BigInt(digits);
}

/** Every word must appear in the requester's first or last name, so "ana pérez" finds Ana María Pérez. */
const requesterNamed = (search: string): Condition => ({
  creator: { user: { AND: search.split(/\s+/).map((word) => ({ OR: [{ firstName: insensitive(word) }, { lastName: insensitive(word) }] })) } },
});

/** The number, the title or the requester's name. */
export function searchFilter(search: string): Condition {
  const number = ticketNumberOf(search);
  return { OR: [...(number === undefined ? [] : [{ number }]), { title: insensitive(search) }, requesterNamed(search)] };
}

/**
 * The filters of the inbox. Each one is its own term of an `AND` with the view and the access filter,
 * so they can only narrow what the caller sees.
 */
export function ticketFilters(query: TicketFiltersQuery, callerId: string): Condition[] {
  return [
    ...(query.status === undefined ? [] : [{ status: query.status }]),
    ...(query.priorityId === undefined ? [] : [{ priorityId: query.priorityId }]),
    ...(query.companyId === undefined ? [] : [{ companyId: query.companyId }]),
    ...(query.categoryId === undefined ? [] : [{ subcategory: { categoryId: query.categoryId } }]),
    ...(query.subcategoryId === undefined ? [] : [{ subcategoryId: query.subcategoryId }]),
    ...(query.siteId === undefined ? [] : [{ siteId: query.siteId }]),
    ...(query.creatorId === undefined ? [] : [{ creatorId: query.creatorId }]),
    ...(query.assigneeId === undefined ? [] : [{ assignees: { some: { userId: query.assigneeId } } }]),
    // Somebody else's tag never matches: a person filters by the tags they put themselves.
    ...(query.tagId === undefined ? [] : [{ tags: { some: { tagId: query.tagId, userId: callerId } } }]),
    ...(query.createdFrom === undefined ? [] : [{ createdAt: { gte: new Date(query.createdFrom) } }]),
    ...(query.createdTo === undefined ? [] : [{ createdAt: { lt: new Date(query.createdTo) } }]),
    ...(query.search === undefined ? [] : [searchFilter(query.search)]),
    ...(query.fieldCode === undefined || query.fieldOperator === undefined
      ? []
      : [fieldFilter({ code: query.fieldCode, operator: query.fieldOperator, value: query.fieldValue, valueTo: query.fieldValueTo })]),
  ];
}

/** Beyond any number a field holds (they are safe integers or have few decimals). */
const NUMBER_LIMIT = 1e18;

/** The day after a `YYYY-MM-DD`, so a date-time on the last day of a range still falls inside it. */
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * A field of the form, by code, so one filter covers every workflow with that field. Values are JSON: dates and
 * date-times are strings (`YYYY-MM-DD`, ISO instants) and numbers are numbers. Postgres orders JSON values of
 * different types by type (strings below numbers below booleans), so each range has both ends of its own type:
 * a date range never matches a number, nor a number range a text.
 */
export function fieldFilter({ code, operator, value, valueTo }: { code: string; operator: FieldFilterOperator; value?: string | undefined; valueTo?: string | undefined }): Condition {
  const withValue = (filter: Condition): Condition => ({ fieldValues: { some: { field: { code }, value: filter } } });
  switch (operator) {
    case 'contains':
      return withValue({ path: [], string_contains: value, mode: 'insensitive' });
    case 'equals': {
      const number = Number(value);
      return { OR: [withValue({ equals: value }), ...(value === undefined || Number.isNaN(number) ? [] : [withValue({ equals: number })])] };
    }
    case 'between': {
      if (fieldRangeKind(value, valueTo) === 'date') return withValue({ gte: value ?? '0000-01-01', lt: valueTo === undefined ? '9999-12-31' : nextDay(valueTo) });
      return withValue({ gte: value === undefined ? -NUMBER_LIMIT : Number(value), lte: valueTo === undefined ? NUMBER_LIMIT : Number(valueTo) });
    }
    case 'filled':
      return { fieldValues: { some: { field: { code } } } };
    case 'empty':
      return { fieldValues: { none: { field: { code } } } };
  }
}

/** What the caller asked to look at; the access filter narrows it further, never widens it. */
export function viewFilter(view: TicketView, caller: SubjectContext): Condition {
  switch (view) {
    case 'created':
      return createdBy(caller.userId);
    case 'assigned':
      return { assignees: { some: { userId: caller.userId } } };
    case 'observed':
      return observedBy(caller);
    case 'all':
      return {};
    case 'history':
      return { slaClocks: { some: { responsibleId: caller.userId } } };
    case 'reopened':
      return { events: { some: { type: 'REOPENED' } } };
    case 'errors_reported':
      return { errors: { some: { reporterId: caller.userId } } };
    case 'errors_received':
      return { errors: { some: { responsibleId: caller.userId } } };
  }
}
