import { Inject, Injectable } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { type IssuedToken, JwtTokenService, type SelectionTokenClaims } from '../../../infrastructure/security/jwt-token-service.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { LoginTokenRepository } from '../data/login-token.repository.js';
import { type SessionLookup, SessionRepository, type StoredSession } from '../data/session.repository.js';
import { REFRESH_REUSE_GRACE_MS, REFRESH_SESSION_TTL_MS } from '../domain/auth-policy.js';
import { TenantAccessService } from './tenant-access.service.js';

export interface ClientInfo {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface OpenedSession {
  readonly accessToken: IssuedToken;
  /** Clear value for the cookie; only its SHA-256 is stored. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/** A session that may be rotated (or switched): not revoked, not expired, of a tenant (never a platform session). */
type LiveSession = { readonly kind: 'valid'; readonly tenantId: string; readonly expiresAt: Date; readonly mfaVerified: boolean };

/**
 * `superseded`: a rotated token within the grace window (another tab won the race); `stale`: a rotated token presented
 * later whose replacement was never used (the answer of that rotation was most likely lost).
 */
type RefreshCheck =
  | LiveSession
  | { readonly kind: 'invalid' | 'reused' | 'superseded' }
  | { readonly kind: 'stale'; readonly replacementId: string };

type Rotation =
  | { readonly kind: 'rotated'; readonly sessionId: string; readonly expiresAt: Date }
  | Exclude<RefreshCheck, LiveSession>;

/**
 * The refresh lost a race with another tab of the same browser, which already set the new cookie: the answer must not
 * clear it. Same 401 `UNAUTHENTICATED` for the client.
 */
export class SupersededRefreshError extends UnauthenticatedError {}

@Injectable()
export class SessionService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(LoginTokenRepository) private readonly loginTokens: LoginTokenRepository,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * Consumes the selection token and creates the session in one transaction: a refused or failed selection does not burn
   * the token, and a token that was already used (or predates a password change) opens nothing.
   */
  async openFromSelection(selection: SelectionTokenClaims, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const { userId } = selection;
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = new Date(this.clock.now().getTime() + REFRESH_SESSION_TTL_MS);
    const sessionId = await this.runner.withUserTransaction(userId, async (tx) => {
      if (!(await this.loginTokens.consume(tx, selection, 'TENANT_SELECTION'))) throw new UnauthenticatedError();
      return this.sessions.create(tx, { userId, activeTenantId: tenantId, tokenHash: sha256Hex(refreshToken), expiresAt: refreshExpiresAt, mfaVerified: selection.mfa, ...client });
    });
    return { accessToken: await this.issueAccessToken(userId, tenantId, sessionId), refreshToken, refreshExpiresAt };
  }

  /**
   * Rotation is mandatory: the presented token stops working and a new one is returned, with the
   * same absolute expiry. Presenting a token that was rotated more than a few seconds ago means it
   * was copied, so every session of the user is revoked.
   */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<OpenedSession> {
    const { owner, session } = await this.livePresented(refreshToken);
    await this.tenantAccess.verify({ userId: owner.userId, tenantId: session.tenantId, mfaVerified: session.mfaVerified, allowDeletionPending: true });
    return this.rotate(owner, { from: session.tenantId, to: session.tenantId }, client);
  }

  /**
   * Moves the session of the presented refresh token to another organization of the same person, without the password:
   * the cookie already proves the sign-in, and the second factor passed in it carries over (an organization that requires
   * it refuses a session that did not pass it). It is a rotation whose replacement belongs to the target tenant, so it
   * keeps the absolute expiry and the reuse detection of `refresh`, and the old access token stops working at once.
   * Everything about the target is checked before the session is touched: a refused switch leaves it as it was. The
   * current tenant as target is a plain rotation.
   */
  async switchTenant(refreshToken: string | undefined, targetTenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const { owner, session } = await this.livePresented(refreshToken);
    await this.verifyTarget(owner.userId, targetTenantId, session.mfaVerified);
    const opened = await this.rotate(owner, { from: session.tenantId, to: targetTenantId }, client);
    this.logger.info('Session moved to another organization', { event: 'auth.tenant_switched', userId: owner.userId, fromTenantId: session.tenantId, toTenantId: targetTenantId });
    return opened;
  }

  /** Revokes the session of the presented refresh token; unknown tokens are ignored. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined) return;
    const owner = await this.runner.withAnonymousTransaction((tx) =>
      this.sessions.findOwnerByTokenHash(tx, sha256Hex(refreshToken)),
    );
    if (owner === undefined) return;
    await this.runner.withUserTransaction(owner.userId, (tx) => this.sessions.revoke(tx, owner.id, this.clock.now()));
  }

  /** The presented token must belong to a live tenant session; otherwise it is refused like a refresh (reuse detection included). */
  private async livePresented(refreshToken: string | undefined): Promise<{ owner: SessionLookup; session: LiveSession }> {
    const owner = await this.findOwner(refreshToken);
    const check = await this.runner.withUserTransaction(owner.userId, async (tx) => {
      const session = await this.sessions.findById(tx, owner.id);
      const replacement = session?.replacedBy ? await this.sessions.findById(tx, session.replacedBy) : undefined;
      return this.classify(session, replacement);
    });
    if (check.kind !== 'valid') return this.refuse(owner.userId, check);
    return { owner, session: check };
  }

  /**
   * No ACTIVE membership in the target (none, INVITED or INACTIVE; or a disabled account) is 403 ORGANIZATION_UNAVAILABLE,
   * as in the tenant selection, not a 401: the session itself is still good, and a 401 would make the client renew it or
   * sign the person out. Whether the organization exists is not told apart. Suspension, pending deletion, maintenance and
   * MFA keep their own errors.
   */
  private async verifyTarget(userId: string, tenantId: string, mfaVerified: boolean): Promise<void> {
    await this.tenantAccess.verify({ userId, tenantId, mfaVerified, allowDeletionPending: true, selectingTenant: true });
  }

  private async findOwner(refreshToken: string | undefined) {
    if (refreshToken === undefined) throw new UnauthenticatedError();
    const owner = await this.runner.withAnonymousTransaction((tx) =>
      this.sessions.findOwnerByTokenHash(tx, sha256Hex(refreshToken)),
    );
    if (owner === undefined) throw new UnauthenticatedError();
    return owner;
  }

  /**
   * A rotated token presented again after the grace window is a stolen copy, unless its replacement was never used: then
   * the answer of that rotation most likely never reached the browser (dropped connection, closed tab), which kept the old
   * cookie. Only that replacement is revoked (the person signs in again in that browser); a replacement that was already
   * rotated means two holders of one session, and every session of the user is revoked.
   */
  private classify(session: StoredSession | undefined, replacement: StoredSession | undefined): RefreshCheck {
    if (session === undefined) return { kind: 'invalid' };
    const now = this.clock.now().getTime();
    if (session.replacedBy !== null) {
      const rotatedAgo = now - (session.revokedAt?.getTime() ?? now);
      if (rotatedAgo <= REFRESH_REUSE_GRACE_MS) return { kind: 'superseded' };
      return replacement !== undefined && this.isLive(replacement) ? { kind: 'stale', replacementId: replacement.id } : { kind: 'reused' };
    }
    if (!this.isLive(session)) return { kind: 'invalid' };
    return { kind: 'valid', tenantId: session.activeTenantId!, expiresAt: session.expiresAt, mfaVerified: session.mfaVerified };
  }

  private isLive(session: StoredSession): boolean {
    return session.revokedAt === null && session.expiresAt.getTime() > this.clock.now().getTime() && session.activeTenantId !== null;
  }

  private async refuse(userId: string, check: Exclude<RefreshCheck, { readonly kind: 'valid' }>): Promise<never> {
    if (check.kind === 'reused') await this.revokeEverySession(userId);
    if (check.kind === 'stale') await this.revokeUnusedReplacement(userId, check.replacementId);
    throw check.kind === 'superseded' ? new SupersededRefreshError() : new UnauthenticatedError();
  }

  /**
   * The row is locked and checked again, so of two concurrent refreshes (or switches) with the same token only one
   * rotates; the other one sees the replacement (or a logout) and is refused. The replacement may belong to another
   * tenant (`switchTenant`); everything else (expiry, second factor) is inherited.
   */
  private async rotate(owner: SessionLookup, tenants: { readonly from: string; readonly to: string }, client: ClientInfo): Promise<OpenedSession> {
    const { id: sessionId, userId } = owner;
    const refreshToken = generateOpaqueToken();
    const rotation = await this.runner.withUserTransaction(userId, async (tx): Promise<Rotation> => {
      const session = await this.sessions.findByIdForUpdate(tx, sessionId);
      const replacement = session?.replacedBy ? await this.sessions.findById(tx, session.replacedBy) : undefined;
      const check = this.classify(session, replacement);
      if (check.kind !== 'valid') return check;
      if (check.tenantId !== tenants.from) return { kind: 'invalid' };
      const id = await this.sessions.create(tx, {
        userId,
        activeTenantId: tenants.to,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: check.expiresAt,
        mfaVerified: check.mfaVerified,
        ...client,
      });
      await this.sessions.markReplaced(tx, sessionId, id, this.clock.now());
      return { kind: 'rotated', sessionId: id, expiresAt: check.expiresAt };
    });
    if (rotation.kind !== 'rotated') return this.refuse(userId, rotation);

    return {
      accessToken: await this.issueAccessToken(userId, tenants.to, rotation.sessionId),
      refreshToken,
      refreshExpiresAt: rotation.expiresAt,
    };
  }

  private issueAccessToken(userId: string, tenantId: string, sessionId: string): Promise<IssuedToken> {
    return this.tokens.issueAccessToken({ sub: userId, tid: tenantId, sid: sessionId });
  }

  private async revokeUnusedReplacement(userId: string, replacementId: string): Promise<void> {
    await this.runner.withUserTransaction(userId, (tx) => this.sessions.revoke(tx, replacementId, this.clock.now()));
    this.logger.warn('Stale refresh token: its unused replacement was revoked', { event: 'auth.refresh_token_stale', userId });
  }

  private async revokeEverySession(userId: string): Promise<void> {
    await this.runner.withUserTransaction(userId, (tx) => this.sessions.revokeAllOfUser(tx, userId, this.clock.now()));
    this.logger.warn('Refresh token reused: every session of the user was revoked', { event: 'auth.refresh_token_reused', userId });
  }
}
