import { Inject, Injectable } from '@nestjs/common';
import { MfaNotEnabledError, type MfaResetRequest, type MfaResetResponse, NotFoundError, type PlatformUserResponse, RateLimitedError } from '@procesabpm/shared';
import { RequestContext } from '../../../common/logging/request-context.js';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { PlatformUserRepository } from '../data/platform-user.repository.js';
import { PLATFORM_USER_SUPPORT_LIMITS } from '../domain/platform-user-support-policy.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/**
 * Support for a person who lost the second factor and the backup codes: find the account by its exact e-mail and reset
 * the factor after verifying who asked. The database function does the reset, revokes every session, mails the user and
 * the owners of their organizations and writes both trails, all in one transaction.
 */
@Injectable()
export class PlatformUserSupportService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(PlatformUserRepository) private readonly users: PlatformUserRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(RequestContext) private readonly requestContext: RequestContext,
  ) {}

  /** Every lookup is audited by the id it found (never the e-mail), also one that found nothing. */
  async lookup(administratorId: string, email: string): Promise<PlatformUserResponse> {
    await this.enforce(`platform-user-lookup:admin:${administratorId}`, PLATFORM_USER_SUPPORT_LIMITS.lookupsPerAdmin);
    const user = await this.runner.run(async (tx) => {
      const found = await this.users.findByEmail(tx, email);
      await this.audit.record(tx, { actorUserId: administratorId, action: PLATFORM_AUDIT_ACTIONS.userLookedUp, data: { userId: found?.id ?? null } });
      return found;
    });
    if (user === undefined) throw new NotFoundError();
    return user;
  }

  async resetMfa(administratorId: string, userId: string, request: MfaResetRequest): Promise<MfaResetResponse> {
    await this.enforce(`platform-mfa-reset:admin:${administratorId}`, PLATFORM_USER_SUPPORT_LIMITS.resetsPerAdmin);
    await this.enforce(`platform-mfa-reset:user:${userId}`, PLATFORM_USER_SUPPORT_LIMITS.resetsPerUser);
    const result = await this.runner.run(async (tx) => {
      const reset = await this.users.resetMfa(tx, {
        administratorId,
        userId,
        reason: request.reason,
        method: request.verification.method,
        reference: request.verification.reference,
        tenantAdminUserId: request.verification.tenantAdminUserId ?? null,
        ipAddress: this.requestContext.current()?.ipAddress ?? null,
      });
      if (reset === undefined) throw (await this.users.exists(tx, userId)) ? new MfaNotEnabledError() : new NotFoundError();
      return reset;
    });
    return { resetAt: result.resetAt.toISOString(), revokedSessions: result.revokedSessions };
  }

  private async enforce(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.limiter.hit(key, rule);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }
}
