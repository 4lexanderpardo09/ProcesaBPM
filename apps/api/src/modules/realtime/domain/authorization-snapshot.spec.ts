import { describe, expect, it } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { sameAuthorization } from './authorization-snapshot.js';

const base: Principal = {
  userId: 'u',
  tenantId: 't',
  sessionId: 's1',
  roleId: 'r',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: false,
  permissionsVersion: 3,
  membership: { departmentId: 'd', siteId: 'site', positionId: 'p' },
};

describe('sameAuthorization', () => {
  it('ignores the session id (a refresh rotates it)', () => {
    expect(sameAuthorization(base, { ...base, sessionId: 's2' })).toBe(true);
  });

  it.each<[string, Partial<Principal>]>([
    ['userId', { userId: 'other' }],
    ['tenantId', { tenantId: 'other' }],
    ['roleId', { roleId: 'other' }],
    ['roleActive', { roleActive: false }],
    ['roleIsAdmin', { roleIsAdmin: true }],
    ['isOwner', { isOwner: true }],
    ['permissionsVersion', { permissionsVersion: 4 }],
    ['departmentId', { membership: { ...base.membership, departmentId: null } }],
    ['siteId', { membership: { ...base.membership, siteId: 'other' } }],
    ['positionId', { membership: { ...base.membership, positionId: null } }],
  ])('a change of %s is a change of authorization', (_field, change) => {
    expect(sameAuthorization(base, { ...base, ...change })).toBe(false);
  });
});
