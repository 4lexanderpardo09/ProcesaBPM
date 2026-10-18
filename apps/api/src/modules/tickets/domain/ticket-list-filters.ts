import type { TicketFiltersQuery, TicketView } from '@procesabpm/shared';
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
export function ticketFilters(query: TicketFiltersQuery): Condition[] {
  return [
    ...(query.status === undefined ? [] : [{ status: query.status }]),
    ...(query.priorityId === undefined ? [] : [{ priorityId: query.priorityId }]),
    ...(query.companyId === undefined ? [] : [{ companyId: query.companyId }]),
    ...(query.categoryId === undefined ? [] : [{ subcategory: { categoryId: query.categoryId } }]),
    ...(query.search === undefined ? [] : [searchFilter(query.search)]),
  ];
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
  }
}
