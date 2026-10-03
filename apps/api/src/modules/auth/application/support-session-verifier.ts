import { Inject, Injectable } from '@nestjs/common';
import { type SupportTokenClaims, UnauthenticatedError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SupportSessionRepository } from '../data/support-session.repository.js';

/**
 * The per-request check of a support token, like `TenantAccessService` is for members: the visit is open, its grant is
 * in force (not revoked, not expired), the administrator still is one and the tenant still exists. A visit that fails
 * the check is closed by the database function, and the request answers 401.
 */
@Injectable()
export class SupportSessionVerifier {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(SupportSessionRepository) private readonly sessions: SupportSessionRepository,
  ) {}

  async verify(claims: SupportTokenClaims): Promise<void> {
    const valid = await this.tenantContext.run({ tenantId: claims.tid, userId: claims.sub }, () =>
      this.runner.withTenantTransaction((tx) => this.sessions.isValid(tx, { tenantId: claims.tid, sessionId: claims.sid, grantId: claims.grant, administratorId: claims.sub })),
    );
    if (!valid) throw new UnauthenticatedError();
  }
}
