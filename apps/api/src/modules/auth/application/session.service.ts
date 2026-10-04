import { Inject, Injectable } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { type IssuedToken, JwtTokenService, type SelectionTokenClaims } from '../../../infrastructure/security/jwt-token-service.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { LoginTokenRepository } from '../data/login-token.repository.js';
import { SessionRepository, type StoredSession } from '../data/session.repository.js';
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

type RefreshCheck =
  | { readonly kind: 'valid'; readonly tenantId: string; readonly expiresAt: Date; readonly mfaVerified: boolean }
  | { readonly kind: 'invalid' | 'reused' };

type Rotation =
  | { readonly kind: 'rotated'; readonly sessionId: string; readonly expiresAt: Date }
  | { readonly kind: 'invalid' | 'reused' };

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
    const owner = await this.findOwner(refreshToken);
    const check = await this.runner.withUserTransaction(owner.userId, async (tx) =>
      this.classify(await this.sessions.findById(tx, owner.id)),
    );
    if (check.kind === 'reused') await this.revokeEverySession(owner.userId);
    if (check.kind !== 'valid') throw new UnauthenticatedError();

    await this.tenantAccess.verify({ userId: owner.userId, tenantId: check.tenantId, mfaVerified: check.mfaVerified, allowDeletionPending: true });
    return this.rotate(owner.id, owner.userId, check.tenantId, client);
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

  private async findOwner(refreshToken: string | undefined) {
    if (refreshToken === undefined) throw new UnauthenticatedError();
    const owner = await this.runner.withAnonymousTransaction((tx) =>
      this.sessions.findOwnerByTokenHash(tx, sha256Hex(refreshToken)),
    );
    if (owner === undefined) throw new UnauthenticatedError();
    return owner;
  }

  private classify(session: StoredSession | undefined): RefreshCheck {
    if (session === undefined) return { kind: 'invalid' };
    const now = this.clock.now().getTime();
    if (session.replacedBy !== null) {
      const rotatedAgo = now - (session.revokedAt?.getTime() ?? now);
      return { kind: rotatedAgo > REFRESH_REUSE_GRACE_MS ? 'reused' : 'invalid' };
    }
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now || session.activeTenantId === null) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', tenantId: session.activeTenantId, expiresAt: session.expiresAt, mfaVerified: session.mfaVerified };
  }

  /**
   * The row is locked and checked again, so of two concurrent refreshes with the same token only one
   * rotates; the other one sees the replacement (or a logout) and is refused.
   */
  private async rotate(sessionId: string, userId: string, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const refreshToken = generateOpaqueToken();
    const rotation = await this.runner.withUserTransaction(userId, async (tx): Promise<Rotation> => {
      const check = this.classify(await this.sessions.findByIdForUpdate(tx, sessionId));
      if (check.kind !== 'valid' || check.tenantId !== tenantId) return { kind: check.kind === 'reused' ? 'reused' : 'invalid' };
      const id = await this.sessions.create(tx, {
        userId,
        activeTenantId: tenantId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: check.expiresAt,
        mfaVerified: check.mfaVerified,
        ...client,
      });
      await this.sessions.markReplaced(tx, sessionId, id, this.clock.now());
      return { kind: 'rotated', sessionId: id, expiresAt: check.expiresAt };
    });
    if (rotation.kind === 'reused') await this.revokeEverySession(userId);
    if (rotation.kind !== 'rotated') throw new UnauthenticatedError();

    return {
      accessToken: await this.issueAccessToken(userId, tenantId, rotation.sessionId),
      refreshToken,
      refreshExpiresAt: rotation.expiresAt,
    };
  }

  private issueAccessToken(userId: string, tenantId: string, sessionId: string): Promise<IssuedToken> {
    return this.tokens.issueAccessToken({ sub: userId, tid: tenantId, sid: sessionId });
  }

  private async revokeEverySession(userId: string): Promise<void> {
    await this.runner.withUserTransaction(userId, (tx) => this.sessions.revokeAllOfUser(tx, userId, this.clock.now()));
    this.logger.warn('Refresh token reused: every session of the user was revoked', { event: 'auth.refresh_token_reused', userId });
  }
}
