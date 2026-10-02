import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { accessMetadataOf, classifyAccess } from '../../../common/auth/route-metadata.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { PlatformSessionService } from '../application/platform-session.service.js';
import { TenantAccessService } from '../application/tenant-access.service.js';
import { bearerToken } from '../../../common/auth/bearer-token.js';

/**
 * Every route needs a valid access token unless it is marked `@Public()` (a route that mixes `@Public`
 * with another access declaration is refused).
 * Besides the signature, each request checks in the database that the membership is still ACTIVE,
 * the tenant ACTIVE and the session not revoked, so revocation takes effect immediately.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
    @Inject(PlatformSessionService) private readonly platformSessions: PlatformSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const routeAccess = classifyAccess(accessMetadataOf(context.getClass(), context.getHandler()));
    if (routeAccess === 'conflict') throw new PermissionDeniedError('The route declares conflicting access rules');
    if (routeAccess === 'public') return true;
    if (context.getType() !== 'http') throw new UnauthenticatedError();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.header('authorization'));
    if (token === undefined) throw new UnauthenticatedError();

    if (routeAccess === 'platform') {
      await this.authenticatePlatform(request, token);
      return true;
    }

    const claims = await this.tokens.verifyAccessToken(token);
    const access = await this.tenantAccess.verify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid });
    request.principal = {
      userId: claims.sub,
      tenantId: claims.tid,
      sessionId: claims.sid,
      roleId: access.roleId,
      roleActive: access.roleActive,
      roleIsAdmin: access.roleIsAdmin,
      isOwner: access.isOwner,
      permissionsVersion: access.permissionsVersion,
      membership: { departmentId: access.departmentId, siteId: access.siteId, positionId: access.positionId },
    };
    return true;
  }

  /**
   * Platform routes take a platform token only. A genuine tenant token is refused with 403 (a valid
   * identity without platform rights); anything else is 401. The principal set here is never a tenant
   * principal, so no tenant context or ability exists for these routes.
   */
  private async authenticatePlatform(request: AuthenticatedRequest, token: string): Promise<void> {
    const claims = await this.platformClaims(token);
    await this.platformSessions.verify(claims.sub, claims.sid);
    request.platformPrincipal = { userId: claims.sub, sessionId: claims.sid };
  }

  private async platformClaims(token: string) {
    try {
      return await this.tokens.verifyPlatformToken(token);
    } catch (error) {
      if (await this.isTenantToken(token)) throw new PermissionDeniedError('A tenant token cannot be used on a platform route');
      throw error;
    }
  }

  private async isTenantToken(token: string): Promise<boolean> {
    try {
      await this.tokens.verifyAccessToken(token);
      return true;
    } catch {
      return false;
    }
  }
}
