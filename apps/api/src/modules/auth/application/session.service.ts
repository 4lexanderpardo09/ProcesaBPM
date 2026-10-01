import { Inject, Injectable } from '@nestjs/common';
import { UnauthenticatedError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { type IssuedToken, JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { SessionRepository, type StoredSession } from '../data/session.repository.js';
import { REFRESH_SESSION_TTL_MS } from '../domain/auth-policy.js';
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

type RefreshCheck = { readonly kind: 'valid'; readonly tenantId: string } | { readonly kind: 'invalid' | 'reused' };

@Injectable()
export class SessionService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async open(userId: string, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = this.refreshExpiry();
    const sessionId = await this.runner.withUserTransaction(userId, (tx) =>
      this.sessions.create(tx, { userId, activeTenantId: tenantId, tokenHash: sha256Hex(refreshToken), expiresAt: refreshExpiresAt, ...client }),
    );
    return { accessToken: await this.issueAccessToken(userId, tenantId, sessionId), refreshToken, refreshExpiresAt };
  }

  /**
   * Rotation is mandatory: the presented token stops working and a new one is returned. Presenting
   * a token that was already rotated means it was copied, so every session of the user is revoked.
   */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<OpenedSession> {
    const owner = await this.findOwner(refreshToken);
    const check = await this.runner.withUserTransaction(owner.userId, async (tx) => {
      const session = await this.sessions.findById(tx, owner.id);
      const result = this.classify(session);
      if (result.kind === 'reused') await this.sessions.revokeAllOfUser(tx, owner.userId, this.clock.now());
      return result;
    });
    if (check.kind === 'reused') this.reportReuse(owner.userId);
    if (check.kind !== 'valid') throw new UnauthenticatedError();

    await this.tenantAccess.verify({ userId: owner.userId, tenantId: check.tenantId });
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
    if (session.replacedBy !== null) return { kind: 'reused' };
    if (session.revokedAt !== null || session.expiresAt <= this.clock.now() || session.activeTenantId === null) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', tenantId: session.activeTenantId };
  }

  private async rotate(sessionId: string, userId: string, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const refreshToken = generateOpaqueToken();
    const refreshExpiresAt = this.refreshExpiry();
    const newSessionId = await this.runner.withUserTransaction(userId, async (tx) => {
      const id = await this.sessions.create(tx, { userId, activeTenantId: tenantId, tokenHash: sha256Hex(refreshToken), expiresAt: refreshExpiresAt, ...client });
      if (await this.sessions.markReplaced(tx, sessionId, id, this.clock.now())) return id;
      // Another request rotated the same token first: treat it as a reused token.
      await this.sessions.revokeAllOfUser(tx, userId, this.clock.now());
      return undefined;
    });
    if (newSessionId === undefined) {
      this.reportReuse(userId);
      throw new UnauthenticatedError();
    }
    return { accessToken: await this.issueAccessToken(userId, tenantId, newSessionId), refreshToken, refreshExpiresAt };
  }

  private issueAccessToken(userId: string, tenantId: string, sessionId: string): Promise<IssuedToken> {
    return this.tokens.issueAccessToken({ sub: userId, tid: tenantId, sid: sessionId });
  }

  private refreshExpiry(): Date {
    return new Date(this.clock.now().getTime() + REFRESH_SESSION_TTL_MS);
  }

  private reportReuse(userId: string): void {
    this.logger.warn('Refresh token reused: every session of the user was revoked', { event: 'auth.refresh_token_reused', userId });
  }
}
