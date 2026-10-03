import type { ExecutionContext } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { Public } from '../../../common/auth/public.decorator.js';
import type { Principal } from '../../../common/auth/principal.js';
import { AuthenticatedOnly, PlatformAdminOnly, RequireAnyPermission, RequirePermission } from '../../../common/auth/route-access.js';
import type { SupportRequestRecorder } from '../../audit/application/support-request-recorder.js';
import type { AbilityService } from '../application/ability.service.js';
import { buildAbility, type RawPermissionRule } from '../domain/build-ability.js';
import { SubjectRegistry } from '../domain/subject-registry.js';
import { type AbilityRequest, PermissionGuard } from './permission.guard.js';

const principal: Principal = {
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: false,
  permissionsVersion: 0,
  membership: { departmentId: null, siteId: null, positionId: null },
};

class Routes {
  @Public()
  open(): void {}
  @AuthenticatedOnly()
  profile(): void {}
  @RequirePermission('read', 'Company')
  readCompany(): void {}
  @RequireAnyPermission(['read_own', 'read_all'], 'Ticket')
  readTickets(): void {}
  undeclared(): void {}
  @Public()
  @RequirePermission('read', 'Company')
  conflicting(): void {}
  @PlatformAdminOnly()
  platform(): void {}
}

function setup(rules: RawPermissionRule[], requestPrincipal: Principal | null = principal) {
  const ability = buildAbility(rules, { userId: 'u1', membership: {} }, new SubjectRegistry()).ability;
  const forPrincipal = vi.fn().mockResolvedValue(ability);
  const record = vi.fn().mockResolvedValue(undefined);
  const guard = new PermissionGuard({ forPrincipal } as unknown as AbilityService, { record } as unknown as SupportRequestRecorder);
  const request: AbilityRequest = { principal: requestPrincipal ?? undefined } as AbilityRequest;
  const call = (handler: keyof Routes) =>
    guard.canActivate({
      getClass: () => Routes,
      getHandler: () => Routes.prototype[handler],
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext);
  return { call, request, forPrincipal, record };
}

const rule = (action: string, subject: string): RawPermissionRule => ({ action, subject, conditions: null });

describe('PermissionGuard', () => {
  it('lets public routes through without building an ability', async () => {
    const { call, forPrincipal } = setup([], null);
    await expect(call('open')).resolves.toBe(true);
    expect(forPrincipal).not.toHaveBeenCalled();
  });

  it('denies an authenticated route that declares nothing, even for manage all', async () => {
    const { call } = setup([rule('manage', 'all')]);
    await expect(call('undeclared')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('refuses a route that mixes @Public with a permission', async () => {
    const { call } = setup([rule('manage', 'all')]);
    await expect(call('conflicting')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('without a principal the answer is 401, never an implicit allow', async () => {
    const { call } = setup([rule('manage', 'all')], null);
    await expect(call('readCompany')).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call('profile')).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call('undeclared')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('authenticated-only routes need a principal and no permission, and still get an ability', async () => {
    const { call, request } = setup([]);
    await expect(call('profile')).resolves.toBe(true);
    expect(request.ability).toBeDefined();
  });

  it.each([
    ['the permission', [rule('read', 'Company')], true],
    ['manage all', [rule('manage', 'all')], true],
    ['manage on the subject', [rule('manage', 'Company')], true],
    ['another action on the subject', [rule('update', 'Company')], false],
    ['the action on another subject', [rule('read', 'Site')], false],
    ['no rules', [], false],
  ])('a route requiring read Company with %s → allowed: %s', async (_label, rules, allowed) => {
    const { call } = setup(rules);
    if (allowed) await expect(call('readCompany')).resolves.toBe(true);
    else await expect(call('readCompany')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('any one of the declared actions is enough', async () => {
    await expect(setup([rule('read_all', 'Ticket')]).call('readTickets')).resolves.toBe(true);
    await expect(setup([rule('read_own', 'Ticket')]).call('readTickets')).resolves.toBe(true);
    await expect(setup([rule('comment', 'Ticket')]).call('readTickets')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('builds the ability for the principal and keeps it on the request', async () => {
    const { call, request, forPrincipal } = setup([rule('read', 'Company')]);
    await call('readCompany');
    expect(forPrincipal).toHaveBeenCalledWith(principal);
    expect(request.ability).toBeDefined();
  });

  describe('platform routes', () => {
    it('are allowed with a platform principal, without building any ability', async () => {
      const { call, request, forPrincipal } = setup([], null);
      request.platformPrincipal = { userId: 'u1', sessionId: 's1' };
      await expect(call('platform')).resolves.toBe(true);
      expect(forPrincipal).not.toHaveBeenCalled();
      expect(request.ability).toBeUndefined();
    });

    it('are refused (401) without a platform principal, even with a tenant principal and manage all', async () => {
      const { call } = setup([rule('manage', 'all')]);
      await expect(call('platform')).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });

  describe('a support visit that is refused', () => {
    const support: Principal = { ...principal, support: { grantId: 'g1' } };

    it('is recorded as DENIED before the 403 goes out', async () => {
      const { call, record, request } = setup([rule('read', 'Company')], support);
      await expect(call('readTickets')).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(record).toHaveBeenCalledWith(request, { tenantId: 't1', userId: 'u1', grantId: 'g1' }, { outcome: 'DENIED', status: 403, code: 'PERMISSION_DENIED' });
    });

    it('is not recorded when it is allowed, nor for an ordinary member', async () => {
      const allowed = setup([rule('read', 'Company')], support);
      await expect(allowed.call('readCompany')).resolves.toBe(true);
      expect(allowed.record).not.toHaveBeenCalled();
      const member = setup([rule('read', 'Company')]);
      await expect(member.call('readTickets')).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(member.record).not.toHaveBeenCalled();
    });
  });
});
