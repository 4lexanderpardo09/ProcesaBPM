import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, SupportAccessNotGrantedError, type SupportSessionResponse, TenantNotFoundError } from '@procesabpm/shared';
import type { PlatformPrincipal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { JwtTokenService, SUPPORT_TOKEN_MAX_TTL_SECONDS } from '../../../infrastructure/security/jwt-token-service.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { SupportSessionRepository } from '../data/support-session.repository.js';
import { TenantAdminRepository } from '../data/tenant-admin.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/**
 * A platform administrator's visit to a tenant that granted support access. The token it gets is read-only, expires at
 * the earlier of 15 minutes and the end of the grant, and is renewed by opening the visit again while the grant lasts.
 * The visit lives only as long as the platform session it was opened from.
 * Opening and closing are recorded in the platform audit log; what the visit does is recorded in the tenant's.
 */
@Injectable()
export class SupportSessionService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(SupportSessionRepository) private readonly sessions: SupportSessionRepository,
    @Inject(TenantAdminRepository) private readonly tenants: TenantAdminRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async open(admin: PlatformPrincipal, tenantId: string): Promise<SupportSessionResponse> {
    const opened = await this.runner.run(async (tx) => {
      if ((await this.tenants.findProfile(tx, tenantId)) === undefined) throw new TenantNotFoundError();
      const session = await this.sessions.open(tx, tenantId, admin.userId, admin.sessionId);
      if (session === undefined) throw new SupportAccessNotGrantedError();
      await this.audit.record(tx, {
        actorUserId: admin.userId,
        action: PLATFORM_AUDIT_ACTIONS.supportSessionOpened,
        targetTenantId: tenantId,
        data: { grantId: session.grantId, sessionId: session.sessionId, grantExpiresAt: session.grantExpiresAt.toISOString() },
      });
      return session;
    });
    const secondsLeft = Math.floor((opened.grantExpiresAt.getTime() - this.clock.now().getTime()) / 1000);
    const ttl = Math.min(SUPPORT_TOKEN_MAX_TTL_SECONDS, secondsLeft);
    if (ttl <= 0) throw new SupportAccessNotGrantedError();
    const token = await this.tokens.issueSupportToken({ sub: admin.userId, tid: tenantId, sid: opened.sessionId, grant: opened.grantId }, ttl);
    return { accessToken: token.token, expiresIn: token.expiresIn, sessionId: opened.sessionId, grantId: opened.grantId, grantExpiresAt: opened.grantExpiresAt.toISOString() };
  }

  close(administratorId: string, tenantId: string, sessionId: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if (!(await this.sessions.close(tx, tenantId, sessionId, this.clock.now()))) throw new NotFoundError();
      await this.audit.record(tx, { actorUserId: administratorId, action: PLATFORM_AUDIT_ACTIONS.supportSessionClosed, targetTenantId: tenantId, data: { sessionId } });
    });
  }
}
