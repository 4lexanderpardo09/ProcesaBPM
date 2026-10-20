import type { TicketDetailResponse } from '@procesabpm/shared';

/** How many names the summary lists before saying "and N more". */
const SHOWN = 2;

/** Who holds the ticket: the people by name (the person first), or why nobody does yet. */
export type AssigneeSummary =
  | { readonly kind: 'people'; readonly names: readonly string[]; readonly more: number }
  | { readonly kind: 'awaitingDispatch' }
  | { readonly kind: 'none' };

export function assigneeSummary(ticket: Pick<TicketDetailResponse, 'assignees' | 'awaitingDispatch'>, userId: string | undefined): AssigneeSummary {
  const people = new Map(ticket.assignees.map((assignee) => [assignee.userId, assignee.name]));
  if (people.size > 0) {
    const names = [...people].sort(([left], [right]) => Number(right === userId) - Number(left === userId)).map(([, name]) => name);
    return { kind: 'people', names: names.slice(0, SHOWN), more: Math.max(0, names.length - SHOWN) };
  }
  return ticket.awaitingDispatch ? { kind: 'awaitingDispatch' } : { kind: 'none' };
}
