import { subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { buildAbility, type RawPermissionRule } from './build-ability.js';
import { member, TEST_SUBJECT, testRegistry } from './test-subjects.js';

const rule = (action: string, subjectName: string, conditions: unknown = null): RawPermissionRule => ({ action, subject: subjectName, conditions });
const build = (rules: RawPermissionRule[], ctx = member) => buildAbility(rules, ctx, testRegistry());
const doc = (fields: Record<string, unknown>) => subject(TEST_SUBJECT, { ...fields }) as never;

describe('buildAbility', () => {
  it('manage all allows every action on every subject', () => {
    const { ability } = build([rule('manage', 'all')]);
    expect(ability.can('anything', 'Workflow')).toBe(true);
    expect(ability.can('read', doc({ ownerId: 'someone' }))).toBe(true);
  });

  it('manage on one subject allows any action on it and nothing else', () => {
    const { ability } = build([rule('manage', 'Delegation')]);
    expect(ability.can('delete', 'Delegation')).toBe(true);
    expect(ability.can('read', 'Workflow')).toBe(false);
  });

  it('allows exactly what the role has: no rule, no access', () => {
    const { ability } = build([rule('read', 'Company')]);
    expect(ability.can('read', 'Company')).toBe(true);
    expect(ability.can('update', 'Company')).toBe(false);
    expect(ability.can('read', 'Site')).toBe(false);
    expect(build([]).ability.can('read', 'Company')).toBe(false);
  });

  it('does not let one action imply another (read does not imply read_all)', () => {
    const { ability } = build([rule('read', 'Ticket'), rule('read_created', 'Ticket')]);
    expect(ability.can('read_all', 'Ticket')).toBe(false);
    expect(ability.can('read_assigned', 'Ticket')).toBe(false);
  });

  it('applies stored conditions to concrete records', () => {
    const { ability } = build([rule('read', TEST_SUBJECT, { ownerId: '${user.id}' })]);
    expect(ability.can('read', doc({ ownerId: 'user-1' }))).toBe(true);
    expect(ability.can('read', doc({ ownerId: 'user-2' }))).toBe(false);
  });

  it('a department condition uses the department of the member', () => {
    const rules = [rule('read', TEST_SUBJECT, { departmentId: '${membership.departmentId}' })];
    expect(build(rules, member).ability.can('read', doc({ departmentId: 'dept-1' }))).toBe(true);
    expect(build(rules, { userId: 'u2', membership: { departmentId: 'dept-2' } }).ability.can('read', doc({ departmentId: 'dept-1' }))).toBe(false);
  });

  it('the same rules give different abilities to different members (nothing is shared between them)', () => {
    const rules = [rule('read', TEST_SUBJECT, { ownerId: '${user.id}' })];
    const first = build(rules, member).ability;
    const second = build(rules, { userId: 'user-2', membership: {} }).ability;
    expect(first.can('read', doc({ ownerId: 'user-1' }))).toBe(true);
    expect(second.can('read', doc({ ownerId: 'user-1' }))).toBe(false);
  });

  it('combines several rules for the same action with OR', () => {
    const { ability } = build([rule('read', TEST_SUBJECT, { ownerId: '${user.id}' }), rule('read', TEST_SUBJECT, { status: 'PUBLIC' })]);
    expect(ability.can('read', doc({ ownerId: 'x', status: 'PUBLIC' }))).toBe(true);
    expect(ability.can('read', doc({ ownerId: 'x', status: 'PRIVATE' }))).toBe(false);
  });

  describe('scoped actions with built-in conditions', () => {
    it('read_own only reaches the own records, even with no stored conditions', () => {
      const { ability } = build([rule('read_own', TEST_SUBJECT)]);
      expect(ability.can('read_own', doc({ ownerId: 'user-1' }))).toBe(true);
      expect(ability.can('read_own', doc({ ownerId: 'user-2' }))).toBe(false);
    });

    it('stored conditions can only narrow a scoped action, never widen it (AND)', () => {
      const { ability } = build([rule('read_own', TEST_SUBJECT, { status: 'OPEN' })]);
      expect(ability.can('read_own', doc({ ownerId: 'user-1', status: 'OPEN' }))).toBe(true);
      expect(ability.can('read_own', doc({ ownerId: 'user-1', status: 'CLOSED' }))).toBe(false);
      expect(ability.can('read_own', doc({ ownerId: 'user-2', status: 'OPEN' }))).toBe(false);
    });

    it('a stored condition that tries to open the scope up does not replace the built-in one', () => {
      const { ability } = build([rule('read_own', TEST_SUBJECT, { ownerId: { not: 'nobody' } })]);
      expect(ability.can('read_own', doc({ ownerId: 'user-2' }))).toBe(false);
    });
  });

  describe('invalid rules are dropped, never widened', () => {
    it.each([
      ['conditions on a subject that accepts none', rule('read', 'Company', { name: 'x' }), 'accepts no conditions'],
      ['a field outside the whitelist', rule('read', TEST_SUBJECT, { secret: 'x' }), 'not allowed'],
      ['an embedded placeholder', rule('read', TEST_SUBJECT, { ownerId: 'a-${user.id}' }), 'placeholder'],
    ])('drops %s', (_label, bad, reason) => {
      const { ability, dropped } = build([bad, rule('read', 'Site')]);
      expect(ability.can('read', 'Company')).toBe(false);
      expect(ability.can('read', doc({ ownerId: 'user-1' }))).toBe(false);
      expect(ability.can('read', 'Site')).toBe(true);
      expect(dropped).toEqual([expect.objectContaining({ action: bad.action, subject: bad.subject, reason: expect.stringContaining(reason) })]);
    });

    it('drops a rule whose placeholder has no value for the member instead of matching records without one', () => {
      const { ability, dropped } = build([rule('read', TEST_SUBJECT, { siteId: '${membership.siteId}' })]);
      expect(ability.can('read', doc({ siteId: null }))).toBe(false);
      expect(ability.can('read', doc({}))).toBe(false);
      expect(dropped).toHaveLength(1);
    });
  });
});
