import { InvalidConditionError, InvalidReferenceError, ValidationFailedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import { groupCatalogBySubject } from './permission-catalog.js';
import { permissionKey, validateRolePermissions } from './role-permission-validation.js';

const catalog = new Set([permissionKey('read', 'Doc'), permissionKey('read', 'Company'), permissionKey('manage', 'all')]);
const registry = new SubjectRegistry().register('Doc', { fields: new Set(['departmentId', 'creatorId']) });

describe('validateRolePermissions', () => {
  it('accepts catalog permissions with and without valid conditions', () => {
    expect(() =>
      validateRolePermissions(
        [
          { action: 'read', subject: 'Company' },
          { action: 'read', subject: 'Doc', conditions: { departmentId: '${membership.departmentId}', creatorId: { in: ['${user.id}', 'x'] } } },
        ],
        catalog,
        registry,
      ),
    ).not.toThrow();
  });

  it('refuses a permission that is not in the catalog', () => {
    expect(() => validateRolePermissions([{ action: 'fly', subject: 'Company' }], catalog, registry)).toThrow(InvalidReferenceError);
  });

  it('refuses the same permission twice', () => {
    expect(() => validateRolePermissions([{ action: 'read', subject: 'Company' }, { action: 'read', subject: 'Company' }], catalog, registry)).toThrow(ValidationFailedError);
  });

  it.each([
    ['a subject that registered no fields', { action: 'read', subject: 'Company', conditions: { name: 'x' } }],
    ['a field the subject does not declare', { action: 'read', subject: 'Doc', conditions: { secret: 'x' } }],
    ['an unknown operator', { action: 'read', subject: 'Doc', conditions: { creatorId: { gt: 1 } } }],
    ['an embedded placeholder', { action: 'read', subject: 'Doc', conditions: { creatorId: 'a-${user.id}' } }],
    ['an unknown placeholder', { action: 'read', subject: 'Doc', conditions: { creatorId: '${user.secret}' } }],
    ['an empty object', { action: 'read', subject: 'Doc', conditions: {} }],
  ])('refuses conditions on %s', (_label, input) => {
    expect(() => validateRolePermissions([input], catalog, registry)).toThrow(InvalidConditionError);
  });

  it('null conditions mean none', () => {
    expect(() => validateRolePermissions([{ action: 'read', subject: 'Company', conditions: null }], catalog, registry)).not.toThrow();
  });
});

describe('groupCatalogBySubject', () => {
  it('groups by subject and flags the subjects that accept conditions', () => {
    const groups = groupCatalogBySubject(
      [
        { action: 'read', subject: 'Doc', description: null },
        { action: 'create', subject: 'Company', description: 'Create' },
        { action: 'update', subject: 'Doc', description: null },
      ],
      registry,
    );
    expect(groups).toEqual([
      { subject: 'Company', acceptsConditions: false, actions: [{ action: 'create', description: 'Create' }] },
      { subject: 'Doc', acceptsConditions: true, actions: [{ action: 'read', description: null }, { action: 'update', description: null }] },
    ]);
  });
});
