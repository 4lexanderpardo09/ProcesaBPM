import type { ExecutionContext } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { Public } from '../../../common/auth/public.decorator.js';
import { PlatformAdminOnly, RequirePermission } from '../../../common/auth/route-access.js';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { PlatformSessionService } from '../application/platform-session.service.js';
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
  @PlatformAdminOnly()
  platformRoute(): void {}
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
  const verifyPlatformToken = vi.fn().mockResolvedValue({ sub: claims.sub, sid: claims.sid });
  const verifyPlatformSession = vi.fn().mockResolvedValue(undefined);
  const guard = new AccessTokenGuard(
    { verifyAccessToken, verifyPlatformToken } as unknown as JwtTokenService,
    { verify } as unknown as TenantAccessService,
    { verify: verifyPlatformSession } as unknown as PlatformSessionService,
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
  return { guard, request, context, conflictContext, verifyAccessToken, verify, verifyPlatformToken, verifyPlatformSession };
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

  describe('platform routes', () => {
    it('need a token', async () => {
      const { guard, context } = setup();
      await expect(guard.canActivate(context('platformRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('accept a platform token whose session is live, and set a platform principal (never a tenant one)', async () => {
      const { guard, context, request, verifyPlatformSession, verify } = setup('Bearer p.q.r');
      await expect(guard.canActivate(context('platformRoute'))).resolves.toBe(true);
      expect(verifyPlatformSession).toHaveBeenCalledWith(claims.sub, claims.sid);
      expect(request.platformPrincipal).toEqual({ userId: claims.sub, sessionId: claims.sid });
      expect(request.principal).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
    });

    it('refuse a genuine tenant token with 403 (valid identity, no platform rights)', async () => {
      const { guard, context, verifyPlatformToken, verifyPlatformSession } = setup('Bearer a.b.c');
      verifyPlatformToken.mockRejectedValue(new UnauthenticatedError());
      await expect(guard.canActivate(context('platformRoute'))).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(verifyPlatformSession).not.toHaveBeenCalled();
    });

    it('answer 401 to a token that is neither a platform nor a tenant token', async () => {
      const { guard, context, verifyPlatformToken, verifyAccessToken } = setup('Bearer junk');
      verifyPlatformToken.mockRejectedValue(new UnauthenticatedError());
      verifyAccessToken.mockRejectedValue(new UnauthenticatedError());
      await expect(guard.canActivate(context('platformRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('answer 401 when the session is revoked, the admin row removed or the account disabled', async () => {
      const { guard, context, request, verifyPlatformSession } = setup('Bearer p.q.r');
      verifyPlatformSession.mockRejectedValue(new UnauthenticatedError());
      await expect(guard.canActivate(context('platformRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(request.platformPrincipal).toBeUndefined();
    });

    it('a platform token does not open a tenant route', async () => {
      const { guard, context, verifyAccessToken } = setup('Bearer p.q.r');
      verifyAccessToken.mockRejectedValue(new UnauthenticatedError());
      await expect(guard.canActivate(context('protectedRoute'))).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
