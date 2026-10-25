import type { NotificationTypeValue } from '@procesabpm/shared';

export const TICKET_EVENT_KINDS = [
  'ticket.created',
  'ticket.assigned',
  'ticket.transitioned',
  'ticket.parallel_task_completed',
  'ticket.closed',
  'ticket.reopened',
  'ticket.commented',
  'ticket.incident_opened',
  'ticket.incident_resolved',
  'sla.overdue',
  'sla.warning',
] as const;
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

/** Why a person is told: being directly responsible beats being the requester, which beats observing. */
export type Rank = 'DIRECT' | 'REQUESTER' | 'OBSERVER';
const RANK_ORDER: Readonly<Record<Rank, number>> = { DIRECT: 0, REQUESTER: 1, OBSERVER: 2 };

export interface Candidate {
  readonly userId: string;
  readonly type: NotificationTypeValue;
  readonly rank: Rank;
  /** Told even when they did it themselves: the receipt of the ticket they just opened, as the help desk sends. */
  readonly evenIfActor?: boolean;
}

/** What the handlers know about a ticket event before deciding who hears about it. */
export interface EventFacts {
  readonly creatorId: string;
  readonly registeredById: string | null;
  readonly assigneeIds: readonly string[];
  readonly observerIds: readonly string[];
  /** `ticket.closed`: everybody who was ever responsible for a step of the ticket. */
  readonly participantIds?: readonly string[] | undefined;
  /** `ticket.assigned`: the person who was assigned. */
  readonly assignedUserId?: string | null | undefined;
  /** `ticket.incident_opened`: who the incident was handed to. */
  readonly incidentAssigneeId?: string | null | undefined;
  /** `ticket.incident_resolved`: who opened the incident. */
  readonly incidentOpenerId?: string | null | undefined;
  /** `sla.overdue`: whoever was responsible when the clock ran out, or the pool when nobody was. */
  readonly overdueResponsibleIds?: readonly string[] | undefined;
  /** `sla.warning`: whoever is responsible for the clock, or the pool when nobody holds it yet. */
  readonly warningResponsibleIds?: readonly string[] | undefined;
}

const direct = (type: NotificationTypeValue, ids: ReadonlyArray<string | null | undefined>): Candidate[] => ids.flatMap((userId) => (userId ? [{ userId, type, rank: 'DIRECT' as const }] : []));
const requester = (type: NotificationTypeValue, facts: EventFacts, evenIfActor = false): Candidate[] => [{ userId: facts.creatorId, type, rank: 'REQUESTER' as const, ...(evenIfActor ? { evenIfActor } : {}) }];
const observers = (facts: EventFacts): Candidate[] => facts.observerIds.map((userId) => ({ userId, type: 'OBSERVER_UPDATE' as const, rank: 'OBSERVER' as const }));

/**
 * Who could be told about an event, before removing repeats and people who cannot read the ticket. It follows the help
 * desk (decision B4): the requester gets the receipt of the ticket opened in their name; the person assigned hears it
 * (and is the only one mailed by default); observers follow the progress (opening, every move, parallel signatures and
 * the close); the close reaches everybody who ever held the ticket; a reopening reaches the requester and whoever has
 * it again; comments notify nobody; an incident reaches whoever it is for, and its resolution whoever gets the ticket
 * back; an overdue clock, whoever is responsible.
 */
export function candidatesFor(kind: TicketEventKind, facts: EventFacts): Candidate[] {
  switch (kind) {
    case 'ticket.created':
      return [...requester('TICKET_CREATED', facts, true), ...observers(facts)];
    case 'ticket.assigned':
      return direct('TICKET_ASSIGNED', [facts.assignedUserId]);
    case 'ticket.transitioned':
    case 'ticket.parallel_task_completed':
      return observers(facts);
    case 'ticket.closed':
      return [...requester('TICKET_CLOSED', facts), ...direct('TICKET_CLOSED', facts.participantIds ?? []), ...observers(facts)];
    case 'ticket.reopened':
      return [...requester('TICKET_REOPENED', facts), ...direct('TICKET_REOPENED', facts.assigneeIds)];
    case 'ticket.commented':
      return [];
    case 'ticket.incident_opened':
      return direct('INCIDENT_OPENED', [facts.incidentAssigneeId]);
    case 'ticket.incident_resolved':
      return direct('INCIDENT_RESOLVED', facts.assigneeIds);
    case 'sla.overdue':
      return direct('SLA_OVERDUE', facts.overdueResponsibleIds ?? []);
    case 'sla.warning':
      // Not in the help desk: a heads-up, only to who can still act in time.
      return direct('SLA_WARNING', facts.warningResponsibleIds ?? []);
  }
}

/** One notification per person: the strongest reason wins, and nobody is told about what they did themselves. */
export function chooseRecipients(candidates: readonly Candidate[], actorId: string | null): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.userId === actorId && candidate.evenIfActor !== true) continue;
    const current = best.get(candidate.userId);
    if (current === undefined || RANK_ORDER[candidate.rank] < RANK_ORDER[current.rank]) best.set(candidate.userId, candidate);
  }
  return [...best.values()];
}
