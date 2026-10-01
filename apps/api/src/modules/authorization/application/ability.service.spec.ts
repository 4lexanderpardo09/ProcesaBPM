import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RolePermissionRepository } from '../data/role-permission.repository.js';
import type { RawPermissionRule } from '../domain/build-ability.js';
import { SubjectRegistry } from '../domain/subject-registry.js';
import type { AbilityCache } from './ability-cache.js';
import { InMemoryAbilityCache } from './ability-cache.js';
import { AbilityService } from './ability.service.js';

const principal: Principal = {
  userId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  tenantId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac',
  sessionId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
  roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae',
  roleActive: true,
  membership: { departmentId: null, siteId: null },
};

function setup(stored: RawPermissionRule[]) {
  const loadRules = vi.fn().mockResolvedValue(stored);
  const runner = { withTenantTransaction: vi.fn((work: (tx: object) => unknown) => work({})) } as unknown as TenantTransactionRunner;
  const warn = vi.fn();
  const cache: AbilityCache = new InMemoryAbilityCache({ now: () => new Date(0) });
  const service = new AbilityService(
    cache,
    new SubjectRegistry(),
    new TenantContext(),
    runner,
    { loadRules } as unknown as RolePermissionRepository,
    { warn } as unknown as JsonLogger,
  );
  return { service, loadRules, warn };
}

const read: RawPermissionRule = { action: 'read', subject: 'Company', conditions: null };

describe('AbilityService', () => {
  it('builds the ability from the rules of the role', async () => {
    const { service } = setup([read]);
    const ability = await service.forPrincipal(principal);
    expect(ability.can('read', 'Company')).toBe(true);
    expect(ability.can('update', 'Company')).toBe(false);
  });

  it('reads a role from the database once and then from the cache', async () => {
    const { service, loadRules } = setup([read]);
    await service.forPrincipal(principal);
    await service.forPrincipal({ ...principal, userId: '018f3c1e-7b2a-7c3d-9e4f-0123456789af' });
    expect(loadRules).toHaveBeenCalledTimes(1);
  });

  it('reads again after the role is invalidated', async () => {
    const { service, loadRules } = setup([read]);
    await service.forPrincipal(principal);
    await service.invalidateRole(principal.tenantId, principal.roleId);
    await service.forPrincipal(principal);
    expect(loadRules).toHaveBeenCalledTimes(2);
  });

  it('reads again after the tenant is invalidated', async () => {
    const { service, loadRules } = setup([read]);
    await service.forPrincipal(principal);
    await service.invalidateTenant(principal.tenantId);
    await service.forPrincipal(principal);
    expect(loadRules).toHaveBeenCalledTimes(2);
  });

  it('a role that is not active grants nothing and does not even touch the database', async () => {
    const { service, loadRules } = setup([{ action: 'manage', subject: 'all', conditions: null }]);
    const ability = await service.forPrincipal({ ...principal, roleActive: false });
    expect(ability.can('read', 'Company')).toBe(false);
    expect(loadRules).not.toHaveBeenCalled();
  });

  it('logs the rules that were dropped and does not apply them', async () => {
    const { service, warn } = setup([{ action: 'read', subject: 'Company', conditions: { name: 'x' } }]);
    const ability = await service.forPrincipal(principal);
    expect(ability.can('read', 'Company')).toBe(false);
    expect(warn).toHaveBeenCalledWith('Permission rule not applied', expect.objectContaining({ event: 'authorization.rule_dropped', subject: 'Company' }));
  });
});
