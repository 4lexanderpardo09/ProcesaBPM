import { describe, expect, it } from 'vitest';
import { type EventFacts, candidatesFor, chooseRecipients } from './recipient-policy.js';

const facts = (overrides: Partial<EventFacts> = {}): EventFacts => ({ creatorId: 'creator', registeredById: null, assigneeIds: ['worker'], observerIds: ['observer'], ...overrides });
const pairs = (kind: Parameters<typeof candidatesFor>[0], overrides: Partial<EventFacts> = {}, actor: string | null = null) =>
  chooseRecipients(candidatesFor(kind, facts(overrides)), actor).map((recipient) => [recipient.userId, recipient.type]);

describe('who hears about a ticket event (as the help desk does)', () => {
  it('ticket.created: the requester gets the receipt even when they opened it themselves, and the observers hear of it', () => {
    expect(pairs('ticket.created', {}, 'creator')).toEqual([['creator', 'TICKET_CREATED'], ['observer', 'OBSERVER_UPDATE']]);
    expect(pairs('ticket.created', { registeredById: 'registrar' }, 'registrar')).toEqual([['creator', 'TICKET_CREATED'], ['observer', 'OBSERVER_UPDATE']]);
  });

  it('ticket.assigned: only the person assigned, unless they did it themselves (taking a ticket)', () => {
    expect(pairs('ticket.assigned', { assignedUserId: 'worker' }, 'supervisor')).toEqual([['worker', 'TICKET_ASSIGNED']]);
    expect(pairs('ticket.assigned', { assignedUserId: 'worker' }, 'worker')).toEqual([]);
  });

  it('a move and a parallel signature: only the observers (whoever gets the ticket hears of it by its assignment)', () => {
    expect(pairs('ticket.transitioned', {}, 'worker')).toEqual([['observer', 'OBSERVER_UPDATE']]);
    expect(pairs('ticket.parallel_task_completed', {}, 'signer')).toEqual([['observer', 'OBSERVER_UPDATE']]);
    expect(pairs('ticket.transitioned', { observerIds: ['worker'] }, 'worker')).toEqual([]);
  });

  it('ticket.closed: the requester, everybody who ever held the ticket and the observers, never the actor', () => {
    expect(pairs('ticket.closed', { participantIds: ['first', 'worker'] }, 'worker')).toEqual([['creator', 'TICKET_CLOSED'], ['first', 'TICKET_CLOSED'], ['observer', 'OBSERVER_UPDATE']]);
  });

  it('ticket.reopened: the requester and whoever has the ticket again, not the observers', () => {
    expect(pairs('ticket.reopened', {}, 'supervisor')).toEqual([['creator', 'TICKET_REOPENED'], ['worker', 'TICKET_REOPENED']]);
    expect(pairs('ticket.reopened', {}, 'creator')).toEqual([['worker', 'TICKET_REOPENED']]);
  });

  it('ticket.commented: nobody, as in the help desk', () => {
    expect(pairs('ticket.commented', {}, 'creator')).toEqual([]);
  });

  it('incidents go to the person they are handed to and, when resolved, to whoever gets the ticket back', () => {
    expect(pairs('ticket.incident_opened', { incidentAssigneeId: 'helper' }, 'worker')).toEqual([['helper', 'INCIDENT_OPENED']]);
    expect(pairs('ticket.incident_resolved', { assigneeIds: ['worker'] }, 'helper')).toEqual([['worker', 'INCIDENT_RESOLVED']]);
  });

  it('sla.overdue: the responsible (or the pool) only; sla.warning, who can still act', () => {
    expect(pairs('sla.overdue', { overdueResponsibleIds: ['worker'] })).toEqual([['worker', 'SLA_OVERDUE']]);
    expect(pairs('sla.overdue', { overdueResponsibleIds: ['pool-a', 'pool-b'] })).toEqual([['pool-a', 'SLA_OVERDUE'], ['pool-b', 'SLA_OVERDUE']]);
    expect(pairs('sla.warning', { warningResponsibleIds: ['worker'] })).toEqual([['worker', 'SLA_WARNING']]);
  });

  it('a person with several reasons gets one notification, with the strongest reason', () => {
    expect(pairs('ticket.closed', { participantIds: ['creator'], observerIds: ['creator'] }, 'worker')).toEqual([['creator', 'TICKET_CLOSED']]);
    expect(pairs('ticket.created', { observerIds: ['creator'] }, 'creator')).toEqual([['creator', 'TICKET_CREATED']]);
  });
});
