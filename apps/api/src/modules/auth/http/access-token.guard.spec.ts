import type { ExecutionContext } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { Public } from '../../../common/auth/public.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { TenantAccessService } from '../application/tenant-access.service.js';
import { AccessTokenGuard } from './access-token.guard.js';

const claims = {
  sub: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
  tid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac',
  sid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad',
};

class Routes {
  protectedRoute(): void {}
  @Public()
  publicRoute(): void {}
  @Public()
  @RequirePermission('read', 'Company')
  conflictingRoute(): void {}
}

@Public()
class PublicController {
  @RequirePermission('read', 'Company')
  protectedByMethod(): void {}
}

function setup(authorization?: string) {
  const verifyAccessToken = vi.fn().mockResolvedValue(claims);
  const access = { roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae', roleActive: true, roleIsAdmin: true, permissionsVersion: 7, isOwner: false, departmentId: null, siteId: null };
  const verify = vi.fn().mockResolvedValue(access);
  const guard = new AccessTokenGuard(
    { verifyAccessToken } as unknown as JwtTokenService,
    { verify } as unknown as TenantAccessService,
  );
  const request = { header: (name: string) => (name === 'authorization' ? authorization : undefined) } as AuthenticatedRequest;
  const context = (handler: keyof Routes) =>
    ({
      getType: () => 'http',
      getHandler: () => Routes.prototype[handler],
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  const conflictContext = () =>
    ({
      getType: () => 'http',
      getHandler: () => PublicController.prototype.protectedByMethod,
      getClass: () => PublicController,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  return { guard, request, context, conflictContext, verifyAccessToken, verify };
}

describe('AccessTokenGuard', () => {
  it('lets public routes through without looking for a token', async () => {
    const { guard, context, verifyAccessToken } = setup();
    await expect(guard.canActivate(context('publicRoute'))).resolves.toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['a route that is public and requires a permission', 'conflictingRoute'],
  ] as const)('refuses %s instead of picking one', async (_label, handler) => {
    const { guard, context, verifyAccessToken } = setup();
    await expect(guard.canActivate(context(handler))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('a class-level @Public never overrides a permission declared on the method', async () => {
    const { guard, conflictContext } = setup();
    await expect(guard.canActivate(conflictContext())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('denies a protected route without a token', async () => {
    const { guard, context } = setup();
    await expect(guard.canActivate(context('protectedRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('checks the signature, then the membership and session in the database, and sets the principal', async () => {
    const { guard, context, request, verifyAccessToken, verify } = setup('Bearer a.b.c');
    await expect(guard.canActivate(context('protectedRoute'))).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('a.b.c');
    expect(verify).toHaveBeenCalledWith({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid });
    expect(request.principal).toEqual({
      userId: claims.sub,
      tenantId: claims.tid,
      sessionId: claims.sid,
      roleId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ae',
      roleActive: true,
      roleIsAdmin: true,
      isOwner: false,
      permissionsVersion: 7,
      membership: { departmentId: null, siteId: null },
    });
  });

  it('does not set the principal when the database check fails', async () => {
    const { guard, context, request, verify } = setup('Bearer a.b.c');
    verify.mockRejectedValue(new UnauthenticatedError());
    await expect(guard.canActivate(context('protectedRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(request.principal).toBeUndefined();
  });

  it('denies non-HTTP contexts', async () => {
    const { guard, context } = setup('Bearer a.b.c');
    const rpc = { ...context('protectedRoute'), getType: () => 'rpc' } as unknown as ExecutionContext;
    await expect(guard.canActivate(rpc)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
