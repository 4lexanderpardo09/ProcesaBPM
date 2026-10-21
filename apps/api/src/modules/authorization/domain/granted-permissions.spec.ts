import { describe, expect, it } from 'vitest';
import { buildAbility } from './build-ability.js';
import { grantedPermissions } from './granted-permissions.js';
import { SubjectRegistry } from './subject-registry.js';

const abilityOf = (rules: ReadonlyArray<{ action: string; subject: string; conditions?: unknown }>) =>
  buildAbility(rules.map((rule) => ({ conditions: null, ...rule })), { userId: 'u1', membership: {} }, new SubjectRegistry()).ability;

describe('grantedPermissions', () => {
  it('lists each granted action and subject once, sorted by subject', () => {
    expect(grantedPermissions(abilityOf([{ action: 'update', subject: 'Category' }, { action: 'read', subject: 'Category' }, { action: 'read', subject: 'Company' }]))).toEqual([
      { action: 'read', subject: 'Category', conditional: false },
      { action: 'update', subject: 'Category', conditional: false },
      { action: 'read', subject: 'Company', conditional: false },
    ]);
  });

  it('keeps manage all as it is (the admin role)', () => {
    expect(grantedPermissions(abilityOf([{ action: 'manage', subject: 'all' }]))).toEqual([{ action: 'manage', subject: 'all', conditional: false }]);
  });

  it('is empty without rules', () => {
    expect(grantedPermissions(abilityOf([]))).toEqual([]);
  });
});
