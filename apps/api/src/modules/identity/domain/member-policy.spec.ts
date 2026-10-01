import { InvalidStateError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { assertCanDeactivate, assertInvitationPending, statusAfterActivation } from './member-policy.js';

const joined = new Date('2026-10-01T00:00:00Z');

describe('member policy', () => {
  it('an invitation is resent only while it is pending', () => {
    expect(() => assertInvitationPending({ status: 'INVITED', joinedAt: null })).not.toThrow();
    expect(() => assertInvitationPending({ status: 'ACTIVE', joinedAt: joined })).toThrow(InvalidStateError);
    expect(() => assertInvitationPending({ status: 'INACTIVE', joinedAt: null })).toThrow(InvalidStateError);
  });

  it('reactivating returns an accepted member to ACTIVE and a never-accepted one to INVITED', () => {
    expect(statusAfterActivation({ status: 'INACTIVE', joinedAt: joined })).toBe('ACTIVE');
    expect(statusAfterActivation({ status: 'INACTIVE', joinedAt: null })).toBe('INVITED');
    expect(() => statusAfterActivation({ status: 'ACTIVE', joinedAt: joined })).toThrow(InvalidStateError);
  });

  it('nobody deactivates themselves, and a deactivated member is not deactivated twice', () => {
    expect(() => assertCanDeactivate({ status: 'ACTIVE', joinedAt: joined }, 'a', 'b')).not.toThrow();
    expect(() => assertCanDeactivate({ status: 'ACTIVE', joinedAt: joined }, 'a', 'a')).toThrow(InvalidStateError);
    expect(() => assertCanDeactivate({ status: 'INACTIVE', joinedAt: joined }, 'a', 'b')).toThrow(InvalidStateError);
  });
});
