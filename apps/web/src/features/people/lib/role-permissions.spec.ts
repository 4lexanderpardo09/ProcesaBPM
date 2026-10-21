import { describe, expect, it } from 'vitest';
import { draftChanged, draftOf, hasPermission, isConditional, permissionsToSave, togglePermission } from './role-permissions';

const saved = [
  { action: 'read', subject: 'Category', conditions: null },
  { action: 'update', subject: 'Ticket', conditions: { companyId: '${user.companyIds}' } },
];

describe('role permissions draft', () => {
  it('reads what the role has, conditions included', () => {
    const draft = draftOf(saved);
    expect(hasPermission(draft, 'read', 'Category')).toBe(true);
    expect(hasPermission(draft, 'create', 'Category')).toBe(false);
    expect(isConditional(draft, 'update', 'Ticket')).toBe(true);
    expect(isConditional(draft, 'read', 'Category')).toBe(false);
    expect(draftChanged(draft, saved)).toBe(false);
  });

  it('adds a permission on every record and keeps the conditions of the others', () => {
    const draft = togglePermission(draftOf(saved), 'create', 'Category', true);
    expect(draftChanged(draft, saved)).toBe(true);
    expect(permissionsToSave(draft)).toEqual([
      { action: 'read', subject: 'Category' },
      { action: 'update', subject: 'Ticket', conditions: { companyId: '${user.companyIds}' } },
      { action: 'create', subject: 'Category' },
    ]);
  });

  it('drops a permission with its conditions, and turning it back on gives it unconditioned', () => {
    const off = togglePermission(draftOf(saved), 'update', 'Ticket', false);
    expect(hasPermission(off, 'update', 'Ticket')).toBe(false);
    const on = togglePermission(off, 'update', 'Ticket', true);
    expect(isConditional(on, 'update', 'Ticket')).toBe(false);
  });

  it('turning on one it has already keeps its conditions', () => {
    expect(isConditional(togglePermission(draftOf(saved), 'update', 'Ticket', true), 'update', 'Ticket')).toBe(true);
  });
});
