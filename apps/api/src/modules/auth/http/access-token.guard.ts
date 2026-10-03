import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PermissionDeniedError, SupportAccessReadOnlyError, type SupportTokenClaims, UnauthenticatedError } from '@procesabpm/shared';
import type { AuthenticatedRequest } from '../../../common/auth/principal.js';
import { accessMetadataOf, classifyAccess } from '../../../common/auth/route-metadata.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { SupportRequestRecorder } from '../../audit/application/support-request-recorder.js';
import { PlatformSessionService } from '../application/platform-session.service.js';
import { AccessTokenAuthenticator } from '../application/access-token-authenticator.js';
import { SupportSessionVerifier } from '../application/support-session-verifier.js';
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
    @Inject(AccessTokenAuthenticator) private readonly authenticator: AccessTokenAuthenticator,
    @Inject(PlatformSessionService) private readonly platformSessions: PlatformSessionService,
    @Inject(SupportSessionVerifier) private readonly supportSessions: SupportSessionVerifier,
    @Inject(SupportRequestRecorder) private readonly supportAudit: SupportRequestRecorder,
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

    const support = await this.supportClaims(token);
    if (support !== undefined) {
      await this.authenticateSupport(request, support);
      return true;
    }

    request.principal = (await this.authenticator.authenticate(token)).principal;
    return true;
  }

  /** `undefined` when the token is not a support token (it is then verified as an ordinary access token). */
  private async supportClaims(token: string): Promise<SupportTokenClaims | undefined> {
    try {
      return await this.tokens.verifySupportToken(token);
    } catch {
      return undefined;
    }
  }

  /**
   * A platform administrator reading one tenant under a grant. Read-only: anything but GET and HEAD is refused. The visit
   * is verified first, so the refusal is attributable (and audited: a write attempt is what the tenant most wants to see).
   * The principal is not a member: its ability is the fixed read-only template (see `AbilityService`).
   */
  private async authenticateSupport(request: AuthenticatedRequest, claims: SupportTokenClaims): Promise<void> {
    await this.supportSessions.verify(claims);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      await this.supportAudit.record(request, { tenantId: claims.tid, userId: claims.sub, grantId: claims.grant }, { outcome: 'DENIED', status: 403, code: 'SUPPORT_ACCESS_READ_ONLY' });
      throw new SupportAccessReadOnlyError();
    }
    request.principal = {
      userId: claims.sub,
      tenantId: claims.tid,
      sessionId: claims.sid,
      roleId: '',
      roleActive: true,
      roleIsAdmin: false,
      isOwner: false,
      permissionsVersion: 0,
      membership: { departmentId: null, siteId: null, positionId: null },
      support: { grantId: claims.grant },
    };
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

  /** A member's or a support token: valid identities, but not platform ones. */
  private async isTenantToken(token: string): Promise<boolean> {
    try {
      await this.tokens.verifyAccessToken(token);
      return true;
    } catch {
      return (await this.supportClaims(token)) !== undefined;
    }
  }
}
