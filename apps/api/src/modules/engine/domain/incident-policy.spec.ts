import { AssigneeRequiredError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { mayResolveIncident, restorePlan, type RestoreInput } from './incident-policy.js';

const plan = (overrides: Partial<RestoreInput> = {}) =>
  restorePlan({ previousAssigneeIds: ['a', 'b'], activeIds: new Set(['a', 'b']), pendingSignerIds: new Set(), poolClockOpen: false, mode: 'USERS', ...overrides });

describe('restorePlan', () => {
  it('gives the ticket back to the original holders as PRIMARY', () => expect(plan({ previousAssigneeIds: ['a'] }).restore).toEqual([{ userId: 'a', type: 'PRIMARY' }]));

  it('a pool comes back as a pool', () => expect(plan({ poolClockOpen: true }).restore.map((entry) => entry.type)).toEqual(['POOL', 'POOL']));

  it('signers with a pending task come back as signers, the others as holders', () =>
    expect(plan({ pendingSignerIds: new Set(['b']) }).restore).toEqual([{ userId: 'a', type: 'PRIMARY' }, { userId: 'b', type: 'PARALLEL' }]));

  it('drops people who are no longer active members and reports them', () => {
    const result = plan({ activeIds: new Set(['b']) });
    expect(result.restore).toEqual([{ userId: 'b', type: 'PRIMARY' }]);
    expect(result.dropped).toEqual(['a']);
  });

  it('needs a named assignee when nobody can come back', () => {
    expect(() => plan({ activeIds: new Set() })).toThrow(AssigneeRequiredError);
    expect(plan({ activeIds: new Set(), explicitAssigneeId: 'z' }).restore).toEqual([]);
  });

  it('steps that assign by themselves, or a ticket that was waiting for a dispatch, need nobody back', () => {
    expect(plan({ activeIds: new Set(), mode: 'PARALLEL' }).restore).toEqual([]);
    expect(plan({ activeIds: new Set(), mode: 'RANDOM_DISPATCH' }).restore).toEqual([]);
    expect(plan({ previousAssigneeIds: [], activeIds: new Set(), poolClockOpen: true }).restore).toEqual([]);
  });
});

describe('mayResolveIncident', () => {
  const incident = { createdById: 'opener', assignedToId: 'handler' };
  const may = (actorId: string, canOpenIncident = false, canReassign = false) => mayResolveIncident({ actorId, incident, canOpenIncident, canReassign });

  it('the person it was handed to', () => expect(may('handler')).toBe(true));
  it('whoever opened it, while they may still open incidents', () => {
    expect(may('opener', true)).toBe(true);
    expect(may('opener', false)).toBe(false);
  });
  it('a supervisor', () => expect(may('boss', false, true)).toBe(true));
  it('nobody else', () => expect(may('stranger', true, false)).toBe(false));
});
