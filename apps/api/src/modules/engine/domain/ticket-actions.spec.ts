import { CloseNotAllowedError, CloseRequiredError, InvalidAssigneeError, InvalidReopenStepError, InvalidTransitionError, type StepDocument, StaleTicketError, TicketNotOpenError, TicketWaitingError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { TicketAction } from './ticket-action-rules.js';
import { mayReceiveIncident, mayReceiveStep, type TicketActionState, ticketActionRefusals, ticketActionsOf } from './ticket-actions.js';

const ME = 'me';
const COMPANY = 'c1';
const NONE: Record<TicketAction, boolean> = { transition: false, reassign: false, close: false, open_incident: false, reopen: false, comment: false, report_error: false, update: false };
const ALL: Record<TicketAction, boolean> = { transition: true, reassign: true, close: true, open_incident: true, reopen: true, comment: true, report_error: true, update: true };
const WORKER: Record<TicketAction, boolean> = { ...NONE, transition: true, close: true, open_incident: true, comment: true };

const step = (overrides: Partial<StepDocument> = {}) => ({ id: 's1', assignmentMode: 'USERS', closeRule: 'ALLOWED', ...overrides }) as StepDocument;

/** An open ticket on a step the caller holds alone, with every permission of a worker. */
const state = (overrides: Partial<TicketActionState> = {}): TicketActionState => ({
  actorId: ME,
  status: 'OPEN',
  companyId: COMPANY,
  visit: { id: 'v1', stepId: 's1', resumeAt: null },
  step: step(),
  hasDecisionExit: true,
  assignees: [{ userId: ME, type: 'PRIMARY' }],
  signatures: [],
  openIncident: null,
  hasReopenTarget: false,
  grants: WORKER,
  ...overrides,
});

const allowed = (value: TicketActionState) =>
  Object.entries(ticketActionsOf(value))
    .filter(([, may]) => may)
    .map(([action]) => action)
    .sort();

describe('ticketActionsOf', () => {
  it('the holder of an open step advances, closes, opens an incident and comments', () => {
    expect(allowed(state())).toEqual(['advance', 'close', 'comment', 'openIncident']);
  });

  it('each flag is exactly "no rule refuses it"', () => {
    const value = state({ grants: ALL });
    const refusals = ticketActionRefusals(value);
    for (const [action, may] of Object.entries(ticketActionsOf(value))) expect(may).toBe(refusals[action as keyof typeof refusals] === null);
  });

  it('a reader without permissions may do nothing', () => {
    expect(allowed(state({ assignees: [{ userId: 'other', type: 'PRIMARY' }], grants: NONE }))).toEqual([]);
  });

  it('a supervisor reassigns a step they do not hold, but neither advances nor closes it', () => {
    expect(allowed(state({ assignees: [{ userId: 'other', type: 'PRIMARY' }], grants: { ...NONE, transition: true, reassign: true, close: true } }))).toEqual(['reassign']);
  });

  it('a pool member takes it, advances and closes it (taking it implicitly)', () => {
    expect(allowed(state({ assignees: [{ userId: ME, type: 'POOL' }, { userId: 'other', type: 'POOL' }] }))).toEqual(['advance', 'close', 'comment', 'openIncident', 'take']);
  });

  it('once someone took it, the rest of the pool lost the race', () => {
    const refusals = ticketActionRefusals(state({ assignees: [{ userId: 'other', type: 'PRIMARY' }] }));
    expect(refusals.take).toBeInstanceOf(StaleTicketError);
  });

  it('a ticket waiting for dispatch is not taken nor advanced; a supervisor hands it to someone', () => {
    expect(ticketActionsOf(state({ assignees: [] })).take).toBe(false);
    expect(allowed(state({ assignees: [], grants: { ...NONE, transition: true, reassign: true } }))).toEqual(['reassign']);
  });

  describe('the step', () => {
    it('without decisions there is nothing to advance through', () => {
      expect(ticketActionRefusals(state({ hasDecisionExit: false })).advance).toBeInstanceOf(InvalidTransitionError);
    });
    it('a step that must close cannot be left by a decision', () => {
      expect(ticketActionRefusals(state({ step: step({ closeRule: 'REQUIRED' }) })).advance).toBeInstanceOf(CloseRequiredError);
      expect(ticketActionsOf(state({ step: step({ closeRule: 'REQUIRED' }) })).close).toBe(true);
    });
    it('a step that does not allow closing is not closed', () => {
      expect(ticketActionRefusals(state({ step: step({ closeRule: 'NOT_ALLOWED' }) })).close).toBeInstanceOf(CloseNotAllowedError);
    });
    it('a step missing from the version refuses advancing and closing', () => {
      expect(ticketActionsOf(state({ step: undefined }))).toMatchObject({ advance: false, close: false });
    });
  });

  describe('parallel step', () => {
    const parallel = (signatures: TicketActionState['signatures'], assignees: TicketActionState['assignees'], grants = WORKER) =>
      state({ step: step({ assignmentMode: 'PARALLEL', closeRule: 'NOT_ALLOWED' }), signatures, assignees, grants });

    it('a signer with a pending signature signs (and may open an incident), but neither advances nor closes', () => {
      const value = parallel([{ userId: ME, status: 'PENDING' }, { userId: 'b', status: 'PENDING' }], [{ userId: ME, type: 'PARALLEL' }, { userId: 'b', type: 'PARALLEL' }]);
      expect(allowed(value)).toEqual(['comment', 'openIncident', 'signParallelTask']);
    });
    it('after signing, nothing is left to sign', () => {
      expect(ticketActionsOf(parallel([{ userId: ME, status: 'SIGNED' }, { userId: 'b', status: 'PENDING' }], [{ userId: 'b', type: 'PARALLEL' }])).signParallelTask).toBe(false);
    });
    it('a supervisor moves a pending signature while one is left', () => {
      const supervisor = { ...NONE, reassign: true };
      expect(ticketActionsOf(parallel([{ userId: 'b', status: 'PENDING' }], [{ userId: 'b', type: 'PARALLEL' }], supervisor)).reassign).toBe(true);
      expect(ticketActionRefusals(parallel([{ userId: 'b', status: 'SIGNED' }], [], supervisor)).reassign).toBeInstanceOf(InvalidAssigneeError);
    });
  });

  describe('the open visit', () => {
    const onTheStep = ['advance', 'take', 'reassign', 'close', 'openIncident', 'signParallelTask'] as const;

    it('a ticket waiting on a WAIT block refuses every action on the step, not comments', () => {
      const refusals = ticketActionRefusals(state({ visit: { id: 'v1', stepId: 's1', resumeAt: new Date('2026-10-21T00:00:00Z') }, grants: ALL }));
      for (const action of onTheStep) expect(refusals[action]).toBeInstanceOf(TicketWaitingError);
      expect(refusals.comment).toBeNull();
    });

    it('a paused ticket is only resolved, by the person the incident is for', () => {
      const paused = state({ status: 'PAUSED', assignees: [{ userId: ME, type: 'INCIDENT' }], openIncident: { status: 'OPEN', createdById: 'opener', assignedToId: ME }, grants: ALL });
      const refusals = ticketActionRefusals(paused);
      for (const action of onTheStep) expect(refusals[action]).toBeInstanceOf(TicketNotOpenError);
      expect(allowed(paused)).toEqual(['comment', 'edit', 'resolveIncident']);
    });

    it('a reader of a paused ticket may not resolve its incident', () => {
      const paused = state({ status: 'PAUSED', assignees: [{ userId: 'helper', type: 'INCIDENT' }], openIncident: { status: 'OPEN', createdById: 'opener', assignedToId: 'helper' } });
      expect(ticketActionsOf(paused).resolveIncident).toBe(false);
    });
  });

  describe('closed ticket', () => {
    const closed = (overrides: Partial<TicketActionState> = {}) => state({ status: 'CLOSED', visit: null, step: undefined, hasDecisionExit: false, assignees: [], hasReopenTarget: true, grants: ALL, ...overrides });

    it('is reopened, nothing else: no more comments either', () => expect(allowed(closed())).toEqual(['reopen']));
    it('is not reopened without the permission', () => expect(ticketActionsOf(closed({ grants: { ...ALL, reopen: false } })).reopen).toBe(false));
    it('one that never reached a person has nowhere to reopen into', () => {
      expect(ticketActionRefusals(closed({ hasReopenTarget: false })).reopen).toBeInstanceOf(InvalidReopenStepError);
    });
  });
});

describe('candidates', () => {
  const member = (userId: string, companyIds = [COMPANY]) => ({ userId, companyIds });

  it('the step goes to a member of the ticket company other than its only holder', () => {
    const value = state();
    expect(mayReceiveStep(value, member('other'))).toBe(true);
    expect(mayReceiveStep(value, member(ME))).toBe(false);
    expect(mayReceiveStep(value, member('elsewhere', ['c2']))).toBe(false);
  });

  it('a pool can go to one of its members', () => {
    expect(mayReceiveStep(state({ assignees: [{ userId: ME, type: 'POOL' }, { userId: 'b', type: 'POOL' }] }), member(ME))).toBe(true);
  });

  it('a signature goes to someone who does not sign the step yet', () => {
    const value = state({ step: step({ assignmentMode: 'PARALLEL' }), signatures: [{ userId: 'a', status: 'PENDING' }, { userId: 'b', status: 'SIGNED' }] });
    expect(mayReceiveStep(value, member('a'))).toBe(false);
    expect(mayReceiveStep(value, member('b'))).toBe(false);
    expect(mayReceiveStep(value, member('c'))).toBe(true);
  });

  it('an incident goes to any member of the ticket company, the caller included', () => {
    expect(mayReceiveIncident(state(), member(ME))).toBe(true);
    expect(mayReceiveIncident(state(), member('elsewhere', ['c2']))).toBe(false);
  });
});
