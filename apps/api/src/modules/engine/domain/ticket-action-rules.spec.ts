import {
  IncidentNotOpenError,
  InvalidStateError,
  NotFoundError,
  ParallelTaskNotPendingError,
  PermissionDeniedError,
  StaleTicketError,
  TicketNotClosedError,
  TicketNotOpenError,
  TicketWaitingError,
  type WorkflowVersionDocument,
} from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import {
  actRefusal,
  commentRefusal,
  decisionExits,
  hasPendingSignature,
  holdsStep,
  holdsStepOrSignature,
  isEligibleAssignee,
  isSigner,
  isSoleHolder,
  openIncidentRefusal,
  openVisitRefusal,
  reassignRefusal,
  reopenRefusal,
  resolveIncidentRefusal,
  signatureRefusal,
  takeRefusal,
} from './ticket-action-rules.js';

const visit = { id: 'v1', resumeAt: null };

describe('holding the step', () => {
  it.each([
    ['PRIMARY', true, true],
    ['POOL', true, true],
    ['PARALLEL', false, true],
    ['INCIDENT', false, false],
    [undefined, false, false],
  ] as const)('%s holds it: %s; for an incident: %s', (type, holds, forIncident) => {
    expect(holdsStep(type)).toBe(holds);
    expect(holdsStepOrSignature(type)).toBe(forIncident);
  });
});

describe('openVisitRefusal', () => {
  it('lets through the open visit the caller saw', () => expect(openVisitRefusal('OPEN', visit, 'v1')).toBeNull());
  it.each(['PAUSED', 'CLOSED'] as const)('a %s ticket is not open', (status) => expect(openVisitRefusal(status, visit, 'v1')).toBeInstanceOf(TicketNotOpenError));
  it('an open ticket without an open visit is in an invalid state', () => expect(openVisitRefusal('OPEN', null, 'v1')).toBeInstanceOf(InvalidStateError));
  it('another visit means someone moved it first', () => expect(openVisitRefusal('OPEN', visit, 'v0')).toBeInstanceOf(StaleTicketError));
  it('a ticket parked on a WAIT block waits', () => expect(openVisitRefusal('OPEN', { id: 'v1', resumeAt: new Date() }, 'v1')).toBeInstanceOf(TicketWaitingError));
  it('a stale visit is reported before the wait', () => expect(openVisitRefusal('OPEN', { id: 'v1', resumeAt: new Date() }, 'v0')).toBeInstanceOf(StaleTicketError));
});

describe('actRefusal', () => {
  it('whoever holds the step, with the permission', () => {
    expect(actRefusal({ may: true, ownType: 'PRIMARY' })).toBeNull();
    expect(actRefusal({ may: true, ownType: 'POOL' })).toBeNull();
    expect(actRefusal({ may: false, ownType: 'PRIMARY' })).toBeInstanceOf(PermissionDeniedError);
  });
  it('nobody answers a step they do not hold, not even a supervisor: they reassign it', () => {
    expect(actRefusal({ may: true, ownType: undefined })).toBeInstanceOf(PermissionDeniedError);
  });
  it('a signer or the incident assignee does not hold the step', () => {
    expect(actRefusal({ may: true, ownType: 'PARALLEL' })).toBeInstanceOf(PermissionDeniedError);
    expect(actRefusal({ may: true, ownType: 'INCIDENT' })).toBeInstanceOf(PermissionDeniedError);
  });
});

describe('takeRefusal', () => {
  it('a pool member with transition takes it', () => expect(takeRefusal(true, 'POOL', [{ userId: 'u', type: 'POOL' }])).toBeNull());
  it('without transition, no', () => expect(takeRefusal(false, 'POOL', [])).toBeInstanceOf(PermissionDeniedError));
  it('someone took it first: 409', () => expect(takeRefusal(true, undefined, [{ userId: 'x', type: 'PRIMARY' }])).toBeInstanceOf(StaleTicketError));
  it('waiting for dispatch is not a pool', () => expect(takeRefusal(true, undefined, [])).toBeInstanceOf(PermissionDeniedError));
  it('the holder does not take what they hold', () => expect(takeRefusal(true, 'PRIMARY', [{ userId: 'u', type: 'PRIMARY' }])).toBeInstanceOf(StaleTicketError));
});

describe('reassign, comment and their permission', () => {
  it('reassign needs reassign', () => {
    expect(reassignRefusal(true)).toBeNull();
    expect(reassignRefusal(false)).toBeInstanceOf(PermissionDeniedError);
  });
  it('comment needs comment, on a ticket that is not closed', () => {
    expect(commentRefusal(true, 'OPEN')).toBeNull();
    expect(commentRefusal(true, 'PAUSED')).toBeNull();
    expect(commentRefusal(false, 'OPEN')).toBeInstanceOf(PermissionDeniedError);
    expect(commentRefusal(true, 'CLOSED')).toBeInstanceOf(TicketNotOpenError);
  });
  it('a signature can only be moved while one is pending', () => {
    expect(hasPendingSignature([{ userId: 'a', status: 'SIGNED' }, { userId: 'b', status: 'PENDING' }])).toBe(true);
    expect(hasPendingSignature([{ userId: 'a', status: 'SIGNED' }])).toBe(false);
  });
});

describe('openIncidentRefusal', () => {
  it.each(['PRIMARY', 'POOL', 'PARALLEL'] as const)('the %s holder opens one', (type) => expect(openIncidentRefusal(true, false, type)).toBeNull());
  it('a supervisor opens one', () => expect(openIncidentRefusal(true, true, undefined)).toBeNull());
  it('nobody without open_incident', () => expect(openIncidentRefusal(false, true, 'PRIMARY')).toBeInstanceOf(PermissionDeniedError));
  it('a reader who does not hold the step does not', () => expect(openIncidentRefusal(true, false, undefined)).toBeInstanceOf(PermissionDeniedError));
});

describe('resolveIncidentRefusal', () => {
  const incident = { status: 'OPEN' as const, createdById: 'opener', assignedToId: 'helper' };
  const base = { actorId: 'helper', incident, ticketStatus: 'PAUSED' as const, hasOpenVisit: true, mayOpenIncident: false, mayReassign: false };
  it('the person it is for resolves it', () => expect(resolveIncidentRefusal(base)).toBeNull());
  it('whoever opened it, while they may still open incidents', () => {
    expect(resolveIncidentRefusal({ ...base, actorId: 'opener', mayOpenIncident: true })).toBeNull();
    expect(resolveIncidentRefusal({ ...base, actorId: 'opener' })).toBeInstanceOf(PermissionDeniedError);
  });
  it('a supervisor', () => expect(resolveIncidentRefusal({ ...base, actorId: 'boss', mayReassign: true })).toBeNull());
  it('anyone else may not', () => expect(resolveIncidentRefusal({ ...base, actorId: 'reader' })).toBeInstanceOf(PermissionDeniedError));
  it('an incident that is not the ticket\'s is not found', () => expect(resolveIncidentRefusal({ ...base, incident: null })).toBeInstanceOf(NotFoundError));
  it('a resolved one is not open', () => expect(resolveIncidentRefusal({ ...base, incident: { ...incident, status: 'RESOLVED' } })).toBeInstanceOf(IncidentNotOpenError));
  it('the ticket must be paused with its visit', () => {
    expect(resolveIncidentRefusal({ ...base, ticketStatus: 'OPEN' })).toBeInstanceOf(InvalidStateError);
    expect(resolveIncidentRefusal({ ...base, hasOpenVisit: false })).toBeInstanceOf(InvalidStateError);
  });
});

describe('reopenRefusal', () => {
  it('a closed ticket with reopen', () => expect(reopenRefusal(true, 'CLOSED')).toBeNull());
  it('the permission is checked first', () => expect(reopenRefusal(false, 'OPEN')).toBeInstanceOf(PermissionDeniedError));
  it.each(['OPEN', 'PAUSED'] as const)('a %s ticket is not closed', (status) => expect(reopenRefusal(true, status)).toBeInstanceOf(TicketNotClosedError));
});

describe('signatureRefusal', () => {
  const signatures = [{ userId: 'me', status: 'PENDING' as const }, { userId: 'done', status: 'SIGNED' as const }];
  it('my pending signature on a parallel step', () => expect(signatureRefusal(true, signatures, 'me')).toBeNull());
  it('not on a step that is not parallel', () => expect(signatureRefusal(false, signatures, 'me')).toBeInstanceOf(InvalidStateError));
  it('not someone who does not sign it', () => expect(signatureRefusal(true, signatures, 'other')).toBeInstanceOf(PermissionDeniedError));
  it('not twice', () => expect(signatureRefusal(true, signatures, 'done')).toBeInstanceOf(ParallelTaskNotPendingError));
});

describe('decisionExits', () => {
  it('the DECISION ways out of the step, in the builder order', () => {
    const document = {
      transitions: [
        { id: 'b', fromStepId: 's', type: 'DECISION', sortOrder: 2 },
        { id: 'sys', fromStepId: 's', type: 'SYSTEM_ONLY', sortOrder: 0 },
        { id: 'a', fromStepId: 's', type: 'DECISION', sortOrder: 1 },
        { id: 'other', fromStepId: 'x', type: 'DECISION', sortOrder: 0 },
      ],
    } as unknown as WorkflowVersionDocument;
    expect(decisionExits(document, 's').map((exit) => exit.id)).toEqual(['a', 'b']);
  });
});

describe('who may receive', () => {
  it('an active member of the ticket company', () => {
    expect(isEligibleAssignee({ companyIds: ['c1', 'c2'] }, 'c2')).toBe(true);
    expect(isEligibleAssignee({ companyIds: ['c1'] }, 'c2')).toBe(false);
    expect(isEligibleAssignee(null, 'c1')).toBe(false);
  });
  it('the sole primary holder already has it', () => {
    expect(isSoleHolder([{ userId: 'u', type: 'PRIMARY' }], 'u')).toBe(true);
    expect(isSoleHolder([{ userId: 'u', type: 'POOL' }], 'u')).toBe(false);
    expect(isSoleHolder([{ userId: 'u', type: 'PRIMARY' }, { userId: 'v', type: 'PRIMARY' }], 'u')).toBe(false);
  });
  it('a signer in any state signs already', () => {
    expect(isSigner([{ userId: 'u', status: 'CANCELLED' }], 'u')).toBe(true);
    expect(isSigner([{ userId: 'u', status: 'PENDING' }], 'v')).toBe(false);
  });
});
