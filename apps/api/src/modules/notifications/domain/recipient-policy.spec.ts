import { describe, expect, it } from 'vitest';
import { type EventFacts, candidatesFor, chooseRecipients } from './recipient-policy.js';

const facts = (overrides: Partial<EventFacts> = {}): EventFacts => ({ creatorId: 'creator', registeredById: null, assigneeIds: ['worker'], observerIds: ['observer'], ...overrides });
const pairs = (kind: Parameters<typeof candidatesFor>[0], overrides: Partial<EventFacts> = {}, actor: string | null = null) =>
  chooseRecipients(candidatesFor(kind, facts(overrides)), actor).map((recipient) => [recipient.userId, recipient.type]);

describe('who hears about a ticket event', () => {
  it('ticket.created: observers always, the creator only when somebody registered it for them', () => {
    expect(pairs('ticket.created')).toEqual([['observer', 'OBSERVER_UPDATE']]);
    expect(pairs('ticket.created', { registeredById: 'registrar' }, 'registrar')).toEqual([['creator', 'TICKET_CREATED'], ['observer', 'OBSERVER_UPDATE']]);
  });

  it('ticket.assigned: only the person assigned, unless they did it themselves (taking a ticket)', () => {
    expect(pairs('ticket.assigned', { assignedUserId: 'worker' }, 'supervisor')).toEqual([['worker', 'TICKET_ASSIGNED']]);
    expect(pairs('ticket.assigned', { assignedUserId: 'worker' }, 'worker')).toEqual([]);
  });

  it.each([
    ['ticket.transitioned', 'TICKET_TRANSITIONED'],
    ['ticket.closed', 'TICKET_CLOSED'],
    ['ticket.reopened', 'TICKET_REOPENED'],
  ] as const)('%s: the creator and the registrant as requesters, observers as observers, never the actor', (kind, type) => {
    expect(pairs(kind, { registeredById: 'registrar' }, 'worker')).toEqual([['creator', type], ['registrar', type], ['observer', 'OBSERVER_UPDATE']]);
    expect(pairs(kind, {}, 'creator')).toEqual([['observer', 'OBSERVER_UPDATE']]);
  });

  it('ticket.commented: requesters and current assignees, but observers are not interrupted by comments', () => {
    expect(pairs('ticket.commented', {}, 'creator')).toEqual([['worker', 'TICKET_COMMENTED']]);
    expect(pairs('ticket.commented', {}, 'worker')).toEqual([['creator', 'TICKET_COMMENTED']]);
  });

  it('incidents go to the person they are handed to and, when resolved, to whoever opened them', () => {
    expect(pairs('ticket.incident_opened', { incidentAssigneeId: 'helper' }, 'worker')).toEqual([['helper', 'INCIDENT_OPENED']]);
    expect(pairs('ticket.incident_resolved', { incidentOpenerId: 'worker' }, 'helper')).toEqual([['worker', 'INCIDENT_RESOLVED']]);
  });

  it('sla.overdue: the responsible (or the pool) and the observers', () => {
    expect(pairs('sla.overdue', { overdueResponsibleIds: ['worker'] })).toEqual([['worker', 'SLA_OVERDUE'], ['observer', 'OBSERVER_UPDATE']]);
    expect(pairs('sla.overdue', { overdueResponsibleIds: ['pool-a', 'pool-b'], observerIds: [] })).toEqual([['pool-a', 'SLA_OVERDUE'], ['pool-b', 'SLA_OVERDUE']]);
  });

  it('a person with several reasons gets one notification, with the strongest reason', () => {
    expect(pairs('ticket.transitioned', { observerIds: ['creator'] }, 'worker')).toEqual([['creator', 'TICKET_TRANSITIONED']]);
    expect(pairs('ticket.commented', { assigneeIds: ['creator'] }, 'other')).toEqual([['creator', 'TICKET_COMMENTED']]);
    expect(pairs('sla.overdue', { overdueResponsibleIds: ['worker'], observerIds: ['worker'] })).toEqual([['worker', 'SLA_OVERDUE']]);
  });
});
