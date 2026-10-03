import { Inject, Injectable } from '@nestjs/common';
import { type GrantSupportAccessRequest, MfaNotVerifiedError, NotFoundError, type SupportAccessResponse, type SupportGrantResponse } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { SupportAccessRepository } from '../data/support-access.repository.js';

const HOUR_MS = 3_600_000;

/**
 * The tenant decides whether, and for how long, platform support may read its data (v1: read-only, at most 72 hours,
 * one grant at a time). Only a session that passed the second factor can open or close the door.
 */
@Injectable()
export class SupportAccessService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(SupportAccessRepository) private readonly grants: SupportAccessRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  get(principal: Principal): Promise<SupportAccessResponse> {
    return this.runner.withTenantTransaction((tx) => this.read(tx, principal.tenantId));
  }

  /** A new grant replaces the one in force (it is revoked in the same transaction). */
  grant(principal: Principal, request: GrantSupportAccessRequest): Promise<SupportGrantResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.assertMfa(tx, principal);
      const now = this.clock.now();
      const replaced = await this.grants.revokeInForce(tx, principal.tenantId, now, null);
      const expiresAt = new Date(now.getTime() + request.hours * HOUR_MS);
      const id = await this.grants.create(tx, { tenantId: principal.tenantId, grantedById: principal.userId, reason: request.reason, startsAt: now, expiresAt });
      await this.audit.record(tx, {
        action: 'support_access.granted',
        subjectType: 'SupportAccess',
        subjectId: id,
        after: { hours: request.hours, expiresAt: expiresAt.toISOString(), reason: request.reason, replaced },
      });
      return (await this.grants.history(tx, principal.tenantId, now)).find((grant) => grant.id === id)!;
    });
  }

  revoke(principal: Principal): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.assertMfa(tx, principal);
      const revoked = await this.grants.revokeInForce(tx, principal.tenantId, this.clock.now(), principal.userId);
      if (revoked.length === 0) throw new NotFoundError();
      await this.audit.record(tx, { action: 'support_access.revoked', subjectType: 'SupportAccess', subjectId: revoked[0]!, after: { grants: revoked } });
    });
  }

  private async read(tx: Parameters<SupportAccessRepository['history']>[0], tenantId: string): Promise<SupportAccessResponse> {
    const history = await this.grants.history(tx, tenantId, this.clock.now());
    return { active: history.find((grant) => grant.status === 'ACTIVE') ?? null, history };
  }

  private async assertMfa(tx: Parameters<SupportAccessRepository['sessionMfaVerified']>[0], principal: Principal): Promise<void> {
    if (!(await this.grants.sessionMfaVerified(tx, principal.sessionId))) throw new MfaNotVerifiedError();
  }
}
