import { Inject, Injectable } from '@nestjs/common';
import { MfaRequiredError, PlatformAccessDeniedError, UnauthenticatedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { type IssuedToken, JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { generateOpaqueToken, sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { LoginTokenRepository } from '../data/login-token.repository.js';
import { PlatformAccessRepository } from '../data/platform-access.repository.js';
import { SessionRepository } from '../data/session.repository.js';
import { PLATFORM_SESSION_TTL_MS } from '../domain/auth-policy.js';
import type { ClientInfo } from './session.service.js';

/**
 * Platform administrators sign in with the same login as everybody (password, lockout, rate limit) and
 * then ask for a platform session instead of choosing a tenant. A platform session is a
 * `refresh_sessions` row with no active tenant and a refresh token nobody ever sees, so it cannot be
 * renewed (nor turned into a tenant session) and dies with a password reset or a logout.
 */
@Injectable()
export class PlatformSessionService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(LoginTokenRepository) private readonly loginTokens: LoginTokenRepository,
    @Inject(PlatformAccessRepository) private readonly access: PlatformAccessRepository,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** With the selection token of the login. Anyone who is not a (current, active) platform admin gets 403. */
  async open(selectionToken: string, client: ClientInfo): Promise<IssuedToken> {
    const selection = await this.tokens.verifySelectionToken(selectionToken);
    // Platform administrators always use the second factor: a token from a sign-in without it opens nothing (and is not consumed).
    if (!selection.mfa) throw new MfaRequiredError();
    const { userId } = selection;
    const sessionId = await this.runner.withUserTransaction(userId, async (tx) => {
      if (!(await this.loginTokens.consume(tx, selection, 'TENANT_SELECTION'))) throw new UnauthenticatedError();
      if (!(await this.credentials.isPlatformAdmin(tx, userId))) throw new PlatformAccessDeniedError();
      return this.sessions.create(tx, {
        userId,
        activeTenantId: null,
        tokenHash: sha256Hex(generateOpaqueToken()),
        expiresAt: new Date(this.clock.now().getTime() + PLATFORM_SESSION_TTL_MS),
        mfaVerified: selection.mfa,
        ...client,
      });
    });
    return this.tokens.issuePlatformToken({ sub: userId, sid: sessionId });
  }

  /** The per-request check: revoked rights, a disabled account or a closed session stop working at once. */
  async verify(userId: string, sessionId: string): Promise<void> {
    const allowed = await this.runner.withUserTransaction(userId, (tx) => this.access.hasAccess(tx, userId, sessionId));
    if (!allowed) throw new UnauthenticatedError();
  }

  async close(userId: string, sessionId: string): Promise<void> {
    await this.runner.withUserTransaction(userId, (tx) => this.sessions.revoke(tx, sessionId, this.clock.now()));
  }
}
