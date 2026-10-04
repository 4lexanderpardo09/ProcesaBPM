import type { ExecutionContext } from '@nestjs/common';
import { TenantPendingDeletionError, UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { AvailableDuringDeletion } from '../../../common/auth/available-during-deletion.decorator.js';
import type { AuthenticatedRequest, Principal, TenantMode } from '../../../common/auth/principal.js';
import type { AccessTokenGuard } from '../../auth/http/access-token.guard.js';
import type { PermissionGuard } from './permission.guard.js';
import { RequestAuthGuard } from './request-auth.guard.js';

class Routes {
  @AvailableDuringDeletion()
  exportData(): void {}
  listTickets(): void {}
}

const principalIn = (tenantMode: TenantMode): Principal => ({
  userId: 'u1',
  tenantId: 't1',
  sessionId: 's1',
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: true,
  isOwner: true,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null },
  tenantMode,
});

function contextFor(handler: keyof Routes, request: AuthenticatedRequest = {} as AuthenticatedRequest): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const context = contextFor('listTickets');

function setup(authentication: () => Promise<boolean>, authorization: () => Promise<boolean> = () => Promise.resolve(true)) {
  const order: string[] = [];
  const auth = { canActivate: vi.fn(async () => (order.push('token'), authentication())) };
  const permission = { canActivate: vi.fn(async () => (order.push('permission'), authorization())) };
  const guard = new RequestAuthGuard(auth as unknown as AccessTokenGuard, permission as unknown as PermissionGuard);
  return { guard, order, auth, permission };
}

describe('RequestAuthGuard', () => {
  it('checks the access token first and the permission second', async () => {
    const { guard, order } = setup(() => Promise.resolve(true));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(order).toEqual(['token', 'permission']);
  });

  it('never runs the permission check when authentication fails', async () => {
    const { guard, permission } = setup(() => Promise.reject(new UnauthenticatedError()));
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(permission.canActivate).not.toHaveBeenCalled();
  });

  it('never runs the permission check when authentication does not grant access', async () => {
    const { guard, permission } = setup(() => Promise.resolve(false));
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(permission.canActivate).not.toHaveBeenCalled();
  });

  it('answers what the permission check answers', async () => {
    const { guard } = setup(() => Promise.resolve(true), () => Promise.resolve(false));
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  describe('a member signed in to an organization pending deletion', () => {
    const request = (tenantMode: TenantMode) => ({ principal: principalIn(tenantMode) }) as AuthenticatedRequest;

    it('is refused on a route not marked @AvailableDuringDeletion, before the permission check', async () => {
      const { guard, permission } = setup(() => Promise.resolve(true));
      await expect(guard.canActivate(contextFor('listTickets', request('DELETION_PENDING')))).rejects.toBeInstanceOf(TenantPendingDeletionError);
      expect(permission.canActivate).not.toHaveBeenCalled();
    });

    it('reaches a marked route, which still goes through the permission check', async () => {
      const { guard, order } = setup(() => Promise.resolve(true));
      await expect(guard.canActivate(contextFor('exportData', request('DELETION_PENDING')))).resolves.toBe(true);
      expect(order).toEqual(['token', 'permission']);
    });

    it('does not change anything for a member of an active organization or a request without a principal', async () => {
      const { guard } = setup(() => Promise.resolve(true));
      await expect(guard.canActivate(contextFor('listTickets', request('ACTIVE')))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor('listTickets'))).resolves.toBe(true);
    });
  });
});
