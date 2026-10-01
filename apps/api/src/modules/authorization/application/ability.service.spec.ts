import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import type { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RolePermissionRepository } from '../data/role-permission.repository.js';
import type { RawPermissionRule } from '../domain/build-ability.js';
import { SubjectRegistry } from '../domain/subject-registry.js';
import { InMemoryAbilityCache } from './ability-cache.js';
import { AbilityService } from './ability.service.js';

const principal: Principal = {
  userId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  tenantId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac',
  sessionId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
  roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: false,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null },
};

const read: RawPermissionRule = { action: 'read', subject: 'Company', conditions: null };

function setup(stored: RawPermissionRule[] = [read], version = 1) {
  const loadRules = vi.fn().mockResolvedValue({ version, rules: stored });
  const runner = { withTenantTransaction: vi.fn((work: (tx: object) => unknown) => work({})) } as unknown as TenantTransactionRunner;
  const warn = vi.fn();
  const cache = new InMemoryAbilityCache({ now: () => new Date(0) });
  const service = new AbilityService(cache, new SubjectRegistry(), new TenantContext(), runner, { loadRules } as unknown as RolePermissionRepository, { warn } as unknown as JsonLogger);
  return { service, loadRules, warn, cache };
}

describe('AbilityService', () => {
  it('builds the ability from the rules of the role', async () => {
    const { service } = setup();
    const ability = await service.forPrincipal(principal);
    expect(ability.can('read', 'Company')).toBe(true);
    expect(ability.can('update', 'Company')).toBe(false);
  });

  it('reads a role from the database once per version and then from the cache', async () => {
    const { service, loadRules } = setup();
    await service.forPrincipal(principal);
    await service.forPrincipal({ ...principal, userId: '018f3c1e-7b2a-7c3d-9e4f-0123456789af' });
    expect(loadRules).toHaveBeenCalledTimes(1);
  });

  it('reads again as soon as the role has a new version (no invalidation call needed)', async () => {
    const { service, loadRules } = setup([read], 2);
    await service.forPrincipal(principal);
    loadRules.mockResolvedValue({ version: 3, rules: [] });
    const after = await service.forPrincipal({ ...principal, permissionsVersion: 3 });
    expect(loadRules).toHaveBeenCalledTimes(2);
    expect(after.can('read', 'Company')).toBe(false);
  });

  it('two instances with separate caches both see a revocation on the next request', async () => {
    const first = setup([read], 1);
    const second = setup([read], 1);
    await first.service.forPrincipal(principal);
    await second.service.forPrincipal(principal);
    first.loadRules.mockResolvedValue({ version: 2, rules: [] });
    second.loadRules.mockResolvedValue({ version: 2, rules: [] });
    const revoked = { ...principal, permissionsVersion: 2 };
    expect((await first.service.forPrincipal(revoked)).can('read', 'Company')).toBe(false);
    expect((await second.service.forPrincipal(revoked)).can('read', 'Company')).toBe(false);
  });

  it('stores the rules under the version they were read with, even when it is newer than the principal\'s', async () => {
    const { service, cache } = setup([read], 5);
    await service.forPrincipal(principal); // the principal says 1, the database says 5
    expect(await cache.get(principal.tenantId, principal.roleId, 5)).toEqual([read]);
    expect(await cache.get(principal.tenantId, principal.roleId, 1)).toBeUndefined();
  });

  it('a role that no longer exists grants nothing', async () => {
    const { service, loadRules } = setup();
    loadRules.mockResolvedValue(undefined);
    expect((await service.forPrincipal(principal)).can('read', 'Company')).toBe(false);
  });

  describe('full access', () => {
    it('the owner can do everything, with no rules at all, and without touching the database', async () => {
      const { service, loadRules } = setup([]);
      const ability = await service.forPrincipal({ ...principal, isOwner: true });
      expect(ability.can('anything', 'Workflow')).toBe(true);
      expect(loadRules).not.toHaveBeenCalled();
    });

    it('the owner keeps full access even if their role is inactive or not admin', async () => {
      const { service } = setup([]);
      const ability = await service.forPrincipal({ ...principal, isOwner: true, roleActive: false, roleIsAdmin: false });
      expect(ability.can('delete', 'Ticket')).toBe(true);
    });

    it('an active admin role means manage all, whatever role_permissions says', async () => {
      const { service, loadRules } = setup([]);
      const ability = await service.forPrincipal({ ...principal, roleIsAdmin: true });
      expect(ability.can('anything', 'Workflow')).toBe(true);
      expect(loadRules).not.toHaveBeenCalled();
    });

    it('an inactive admin role (and not the owner) grants nothing', async () => {
      const { service } = setup([{ action: 'manage', subject: 'all', conditions: null }]);
      const ability = await service.forPrincipal({ ...principal, roleIsAdmin: true, roleActive: false });
      expect(ability.can('read', 'Company')).toBe(false);
    });

    it('a manage all row on a role that is not admin stays honored as an explicit grant', async () => {
      const { service } = setup([{ action: 'manage', subject: 'all', conditions: null }]);
      expect((await service.forPrincipal(principal)).can('read', 'Company')).toBe(true);
    });
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
