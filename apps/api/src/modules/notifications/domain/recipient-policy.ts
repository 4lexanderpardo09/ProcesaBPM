import type { NotificationTypeValue } from '@procesabpm/shared';

export const TICKET_EVENT_KINDS = [
  'ticket.created',
  'ticket.assigned',
  'ticket.transitioned',
  'ticket.closed',
  'ticket.reopened',
  'ticket.commented',
  'ticket.incident_opened',
  'ticket.incident_resolved',
  'sla.overdue',
] as const;
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

/** Why a person is told: being directly responsible beats being the requester, which beats observing. */
export type Rank = 'DIRECT' | 'REQUESTER' | 'OBSERVER';
const RANK_ORDER: Readonly<Record<Rank, number>> = { DIRECT: 0, REQUESTER: 1, OBSERVER: 2 };

export interface Candidate {
  readonly userId: string;
  readonly type: NotificationTypeValue;
  readonly rank: Rank;
}

/** What the handlers know about a ticket event before deciding who hears about it. */
export interface EventFacts {
  readonly creatorId: string;
  readonly registeredById: string | null;
  readonly assigneeIds: readonly string[];
  readonly observerIds: readonly string[];
  /** `ticket.assigned`: the person who was assigned. */
  readonly assignedUserId?: string | null | undefined;
  /** `ticket.incident_opened`: who the incident was handed to. */
  readonly incidentAssigneeId?: string | null | undefined;
  /** `ticket.incident_resolved`: who opened the incident. */
  readonly incidentOpenerId?: string | null | undefined;
  /** `sla.overdue`: whoever was responsible when the clock ran out, or the pool when nobody was. */
  readonly overdueResponsibleIds?: readonly string[] | undefined;
}

const direct = (type: NotificationTypeValue, ids: ReadonlyArray<string | null | undefined>): Candidate[] => ids.flatMap((userId) => (userId ? [{ userId, type, rank: 'DIRECT' as const }] : []));
const requesters = (type: NotificationTypeValue, facts: EventFacts): Candidate[] => [facts.creatorId, facts.registeredById].flatMap((userId) => (userId ? [{ userId, type, rank: 'REQUESTER' as const }] : []));
const observers = (facts: EventFacts): Candidate[] => facts.observerIds.map((userId) => ({ userId, type: 'OBSERVER_UPDATE' as const, rank: 'OBSERVER' as const }));

/** Who could be told about an event, before removing the actor, repeats and people who cannot read the ticket. */
export function candidatesFor(kind: TicketEventKind, facts: EventFacts): Candidate[] {
  switch (kind) {
    case 'ticket.created':
      // The creator knows: they did it. Only when somebody registered it for them (and that somebody is the actor) is it news.
      return [...(facts.registeredById !== null && facts.registeredById !== facts.creatorId ? requesters('TICKET_CREATED', { ...facts, registeredById: null }) : []), ...observers(facts)];
    case 'ticket.assigned':
      return direct('TICKET_ASSIGNED', [facts.assignedUserId]);
    case 'ticket.transitioned':
      return [...requesters('TICKET_TRANSITIONED', facts), ...observers(facts)];
    case 'ticket.closed':
      return [...requesters('TICKET_CLOSED', facts), ...observers(facts)];
    case 'ticket.reopened':
      return [...requesters('TICKET_REOPENED', facts), ...observers(facts)];
    case 'ticket.commented':
      return [...requesters('TICKET_COMMENTED', facts), ...direct('TICKET_COMMENTED', facts.assigneeIds)];
    case 'ticket.incident_opened':
      return direct('INCIDENT_OPENED', [facts.incidentAssigneeId]);
    case 'ticket.incident_resolved':
      return direct('INCIDENT_RESOLVED', [facts.incidentOpenerId]);
    case 'sla.overdue':
      return [...direct('SLA_OVERDUE', facts.overdueResponsibleIds ?? []), ...observers(facts)];
  }
}

/** One notification per person: the strongest reason wins, and nobody is told about what they did themselves. */
export function chooseRecipients(candidates: readonly Candidate[], actorId: string | null): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.userId === actorId) continue;
    const current = best.get(candidate.userId);
    if (current === undefined || RANK_ORDER[candidate.rank] < RANK_ORDER[current.rank]) best.set(candidate.userId, candidate);
  }
  return [...best.values()];
}
