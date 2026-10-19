import type { TicketDetailResponse } from '@procesabpm/shared';

/** Who holds the ticket, as the API can tell it today (ids, no names): the person, how many others, or nobody yet. */
export type AssigneeSummary =
  | { readonly kind: 'you'; readonly others: number }
  | { readonly kind: 'others'; readonly count: number }
  | { readonly kind: 'awaitingDispatch' }
  | { readonly kind: 'none' };

export function assigneeSummary(ticket: Pick<TicketDetailResponse, 'assignees' | 'awaitingDispatch'>, userId: string | undefined): AssigneeSummary {
  const people = new Set(ticket.assignees.map((assignee) => assignee.userId));
  if (userId !== undefined && people.has(userId)) return { kind: 'you', others: people.size - 1 };
  if (people.size > 0) return { kind: 'others', count: people.size };
  return ticket.awaitingDispatch ? { kind: 'awaitingDispatch' } : { kind: 'none' };
}
