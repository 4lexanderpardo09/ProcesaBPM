import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '@procesabpm/shared';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { TenantAccessService } from '../application/tenant-access.service.js';
import { bearerToken } from './bearer-token.js';

/**
 * Global and deny-by-default: every route needs a valid access token unless it is marked `@Public()`.
 * Besides the signature, each request checks in the database that the membership is still ACTIVE,
 * the tenant ACTIVE and the session not revoked, so revocation takes effect immediately.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;
    if (context.getType() !== 'http') throw new UnauthenticatedError();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.header('authorization'));
    if (token === undefined) throw new UnauthenticatedError();

    const claims = await this.tokens.verifyAccessToken(token);
    await this.tenantAccess.verify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid });
    request.principal = { userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid };
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) === true;
  }
}
