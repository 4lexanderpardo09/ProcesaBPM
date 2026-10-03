import { Inject, Injectable } from '@nestjs/common';
import { MfaRequiredError, TenantPendingDeletionError, TenantSuspendedError, UnauthenticatedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type SessionState, type TenantAccess, TenantAccessRepository } from '../data/tenant-access.repository.js';

export type VerifiedAccess = NonNullable<TenantAccess['membership']>;

export interface AccessRequest {
  readonly userId: string;
  readonly tenantId: string;
  /** When present, the session must be the live one opened for this tenant. */
  readonly sessionId?: string;
  /** Without a session (tenant selection, refresh): whether the second factor was passed in the sign-in being used. */
  readonly mfaVerified?: boolean;
}

/**
 * The check behind every authenticated request, tenant selection and refresh: the account and the
 * membership are ACTIVE, the tenant is ACTIVE, the session has not been revoked and, when the organization requires
 * two-step verification, the session passed it. One transaction
 * per call, so disabling a user or a membership takes effect on the next request.
 */
@Injectable()
export class TenantAccessService {
  constructor(
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantAccessRepository) private readonly repository: TenantAccessRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Returns the role and placement of the member, read in the same transaction as the checks. */
  verify(request: AccessRequest): Promise<VerifiedAccess> {
    const scope = { tenantId: request.tenantId, userId: request.userId };
    return this.tenantContext.run(scope, () =>
      this.runner.withTenantTransaction(async (tx) => {
        const access = await this.repository.findAccess(tx, request.tenantId, request.userId);
        const membership = access.membership;
        const allowed = access.userStatus === 'ACTIVE' && access.membershipStatus === 'ACTIVE' && access.tenantStatus !== undefined;
        if (!allowed || membership === undefined) throw new UnauthenticatedError();
        let mfaVerified = request.mfaVerified === true;
        if (request.sessionId !== undefined) {
          const session = await this.repository.findSession(tx, request.sessionId);
          if (!this.isLive(session, request.tenantId)) throw new UnauthenticatedError();
          mfaVerified = session!.mfaVerified;
        }
        if (access.tenantStatus === 'PENDING_DELETION') throw new TenantPendingDeletionError();
        if (access.tenantStatus !== 'ACTIVE') throw new TenantSuspendedError();
        // Turning the policy on takes effect at the next request of every member who has not passed the second factor.
        if (access.tenantMfaRequired && !mfaVerified) throw new MfaRequiredError();
        return membership;
      }),
    );
  }

  private isLive(session: SessionState | undefined, tenantId: string): boolean {
    return (
      session !== undefined &&
      session.revokedAt === null &&
      session.activeTenantId === tenantId &&
      session.expiresAt > this.clock.now()
    );
  }
}
