import { PermissionDeniedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { buildAbility, type RawPermissionRule } from './build-ability.js';
import { accessibleWhere, assertCanOnRecord, canAnyOnRecord, canOnRecord } from './record-access.js';
import { member, TEST_SUBJECT, testRegistry } from './test-subjects.js';

const rule = (action: string, conditions: unknown = null): RawPermissionRule => ({ action, subject: TEST_SUBJECT, conditions });
const abilityOf = (...rules: RawPermissionRule[]) => buildAbility(rules, member, testRegistry()).ability;

const own = { id: 'doc-1', ownerId: 'user-1', departmentId: 'dept-1' };
const foreign = { id: 'doc-2', ownerId: 'user-2', departmentId: 'dept-2' };

describe('record access', () => {
  it('own record vs read_all: the same type-level permission, different record access', () => {
    const scoped = abilityOf(rule('read_own'));
    const all = abilityOf(rule('read_all'));
    expect(scoped.can('read_own', TEST_SUBJECT)).toBe(true);
    expect(canOnRecord(scoped, 'read_own', TEST_SUBJECT, own)).toBe(true);
    expect(canOnRecord(scoped, 'read_own', TEST_SUBJECT, foreign)).toBe(false);
    expect(canOnRecord(all, 'read_all', TEST_SUBJECT, foreign)).toBe(true);
  });

  it('a type-level check is true for a role with only conditional rules, so it cannot authorize a record', () => {
    const scoped = abilityOf(rule('read', { ownerId: '${user.id}' }));
    expect(scoped.can('read', TEST_SUBJECT)).toBe(true);
    expect(canOnRecord(scoped, 'read', TEST_SUBJECT, foreign)).toBe(false);
  });

  it('a record that lacks the fields the condition needs is denied', () => {
    const ability = abilityOf(rule('read', { departmentId: '${membership.departmentId}' }));
    expect(canOnRecord(ability, 'read', TEST_SUBJECT, { id: 'x' })).toBe(false);
  });

  it('does not modify the record it was given', () => {
    const record = { ownerId: 'user-1' };
    canOnRecord(abilityOf(rule('read_own')), 'read_own', TEST_SUBJECT, record);
    expect(Object.keys(record)).toEqual(['ownerId']);
  });

  it('canAnyOnRecord accepts any one of the actions', () => {
    const ability = abilityOf(rule('read_own'), rule('read_assigned', { departmentId: '${membership.departmentId}' }));
    const actions = ['read_own', 'read_assigned', 'read_all'];
    expect(canAnyOnRecord(ability, actions, TEST_SUBJECT, own)).toBe(true);
    expect(canAnyOnRecord(ability, actions, TEST_SUBJECT, { ownerId: 'user-2', departmentId: 'dept-1' })).toBe(true);
    expect(canAnyOnRecord(ability, actions, TEST_SUBJECT, foreign)).toBe(false);
  });

  it('assertCanOnRecord throws a 403 domain error', () => {
    const ability = abilityOf(rule('read_own'));
    expect(() => assertCanOnRecord(ability, 'read_own', TEST_SUBJECT, own)).not.toThrow();
    expect(() => assertCanOnRecord(ability, 'read_own', TEST_SUBJECT, foreign)).toThrow(PermissionDeniedError);
    expect(() => assertCanOnRecord(ability, ['read_own', 'read_all'], TEST_SUBJECT, foreign)).toThrow(PermissionDeniedError);
  });

  describe('accessibleWhere (listings)', () => {
    it('returns the Prisma filter of the rules', () => {
      const ability = abilityOf(rule('read_own'), rule('read', { departmentId: { in: ['dept-1', 'dept-9'] } }));
      expect(accessibleWhere(ability, 'read_own', TEST_SUBJECT)).toEqual({ OR: [{ ownerId: 'user-1' }] });
      expect(accessibleWhere(ability, 'read', TEST_SUBJECT)).toEqual({ OR: [{ departmentId: { in: ['dept-1', 'dept-9'] } }] });
    });

    it('joins the actions with OR', () => {
      const ability = abilityOf(rule('read_own'), rule('read_all', { status: 'OPEN' }));
      expect(accessibleWhere(ability, ['read_own', 'read_all'], TEST_SUBJECT)).toEqual({
        OR: [{ OR: [{ ownerId: 'user-1' }] }, { OR: [{ status: 'OPEN' }] }],
      });
    });

    it('matches nothing, never everything, when the role has no rule for the action', () => {
      const ability = abilityOf(rule('read_own'));
      expect(accessibleWhere(ability, 'read_all', TEST_SUBJECT)).toEqual({ id: { in: [] } });
      expect(accessibleWhere(abilityOf(), ['read_all', 'read_own'], TEST_SUBJECT)).toEqual({ id: { in: [] } });
    });
  });
});
