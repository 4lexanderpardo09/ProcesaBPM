import { Inject, Injectable } from '@nestjs/common';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantAccessService } from './tenant-access.service.js';

export interface AuthenticatedAccess {
  readonly principal: Principal;
  readonly expiresAt: Date;
}

export interface AuthenticationOptions {
  /** See `AccessRequest.allowDeletionPending`: only the HTTP guard asks for it, never real time. */
  readonly allowDeletionPending?: boolean;
}

export interface SessionIdentity {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
}

/**
 * The one way an access token becomes a principal: the HTTP guard and the WebSocket handshake both call it, so a socket
 * is accepted exactly when the same request over HTTP would be (signature, audience, account, membership, tenant,
 * live session of that tenant, MFA policy), except that only HTTP lets a full-access member into an organization pending
 * deletion (`allowDeletionPending`).
 */
@Injectable()
export class AccessTokenAuthenticator {
  constructor(
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
  ) {}

  async authenticate(token: string, options: AuthenticationOptions = {}): Promise<AuthenticatedAccess> {
    const { claims, expiresAt } = await this.tokens.inspectAccessToken(token);
    const principal = await this.reverify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid }, options);
    return { principal, expiresAt };
  }

  /** The same database checks for an identity already verified: used to re-check a live socket without a token. */
  async reverify(identity: SessionIdentity, options: AuthenticationOptions = {}): Promise<Principal> {
    const access = await this.tenantAccess.verify({
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      allowDeletionPending: options.allowDeletionPending === true,
    });
    return {
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      roleId: access.roleId,
      roleActive: access.roleActive,
      roleIsAdmin: access.roleIsAdmin,
      isOwner: access.isOwner,
      permissionsVersion: access.permissionsVersion,
      membership: { departmentId: access.departmentId, siteId: access.siteId, positionId: access.positionId },
      tenantMode: access.tenantMode,
    };
  }
}
