import { PERMISSIONS } from '@procesabpm/db';
import { describe, expect, it } from 'vitest';
import { buildAbility } from './build-ability.js';
import { SubjectRegistry } from './subject-registry.js';
import { SUPPORT_READ_ONLY_RULES } from './support-rules.js';

describe('the support read-only template', () => {
  const { ability } = buildAbility(SUPPORT_READ_ONLY_RULES, { userId: 'admin', membership: {} }, new SubjectRegistry());

  it('only reads', () => {
    for (const rule of SUPPORT_READ_ONLY_RULES) expect(['read', 'read_all']).toContain(rule.action);
    expect(SUPPORT_READ_ONLY_RULES.length).toBeGreaterThan(10);
  });

  it('reads the tenant configuration and every ticket', () => {
    expect(ability.can('read', 'Company')).toBe(true);
    expect(ability.can('read', 'Workflow')).toBe(true);
    expect(ability.can('read_all', 'Ticket')).toBe(true);
  });

  it('can do nothing else on any subject of the catalog: no create, update, delete, comment, transition, manage', () => {
    const writes = PERMISSIONS.filter((permission) => permission.action !== 'read' && permission.action !== 'read_all');
    for (const permission of writes) expect(ability.can(permission.action, permission.subject), `${permission.action} ${permission.subject}`).toBe(false);
    expect(ability.can('manage', 'all')).toBe(false);
  });

  it('does not read secrets, settings, the tenant audit log, nor the "mine" scopes of tickets', () => {
    expect(ability.can('read', 'Webhook')).toBe(false);
    expect(ability.can('read', 'AuditLog')).toBe(false);
    expect(ability.can('read', 'Setting')).toBe(false);
    expect(ability.can('manage', 'SupportAccess')).toBe(false);
    for (const action of ['read_created', 'read_assigned', 'read_observed']) expect(ability.can(action, 'Ticket')).toBe(false);
  });

  it('denies by default on a subject that is not in the catalog', () => {
    expect(ability.can('read', 'Whatever')).toBe(false);
  });
});
