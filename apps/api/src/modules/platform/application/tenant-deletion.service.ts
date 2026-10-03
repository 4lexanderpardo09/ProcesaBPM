import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, type RequestTenantDeletion, TenantNotFoundError, type TenantDeletionResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { TENANT_DELETION_REQUESTED_EVENT } from '../../../infrastructure/outbox/platform-event-types.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { TenantDeletionRepository } from '../data/tenant-deletion.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/**
 * Deleting a tenant takes two steps and 30 days. Asking locks everybody out at once (sessions and support grants end,
 * members get 403 TENANT_PENDING_DELETION) and tells the owner; the worker purges the files and the data after the period.
 * Until then it can be cancelled, which leaves the tenant SUSPENDED: reactivating is a separate, deliberate step.
 */
@Injectable()
export class TenantDeletionService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(TenantDeletionRepository) private readonly deletions: TenantDeletionRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  request(actorUserId: string, tenantId: string, request: RequestTenantDeletion): Promise<TenantDeletionResponse> {
    return this.runner.run(async (tx) => {
      const tenant = await this.deletions.lock(tx, tenantId);
      if (tenant === undefined) throw new TenantNotFoundError();
      if (request.confirmName !== tenant.name) throw new InvalidStateError('The confirmation does not match the name of the organization');
      if (tenant.status !== 'ACTIVE' && tenant.status !== 'SUSPENDED') throw new InvalidStateError(`A ${tenant.status.toLowerCase().replace('_', ' ')} tenant cannot be deleted`);

      const now = this.clock.now();
      const purgeAfter = await this.deletions.markPending(tx, tenantId, actorUserId);
      await this.deletions.revokeSessions(tx, tenantId, now);
      await this.deletions.revokeSupportAccess(tx, tenantId, now);
      const ownerId = await this.deletions.findOwnerUserId(tx, tenantId);
      if (ownerId !== undefined) await this.outbox.enqueue(tx, TENANT_DELETION_REQUESTED_EVENT, { tenantId, userId: ownerId });
      await this.audit.record(tx, {
        actorUserId,
        action: PLATFORM_AUDIT_ACTIONS.tenantDeletionRequested,
        targetTenantId: tenantId,
        data: { reason: request.reason, purgeAfter: purgeAfter.toISOString(), previousStatus: tenant.status },
      });
      return { tenantId, status: 'PENDING_DELETION', purgeAfter: purgeAfter.toISOString() };
    });
  }

  cancel(actorUserId: string, tenantId: string): Promise<TenantDeletionResponse> {
    return this.runner.run(async (tx) => {
      const tenant = await this.deletions.lock(tx, tenantId);
      if (tenant === undefined) throw new TenantNotFoundError();
      if (tenant.status !== 'PENDING_DELETION') throw new InvalidStateError('The tenant is not pending deletion');
      // Once the period is over the purge may already have started (files are removed before the data): too late.
      if (tenant.purgeAfter !== null && tenant.purgeAfter <= this.clock.now()) throw new InvalidStateError('The period is over: the purge is due and can no longer be cancelled');
      if (tenant.purgeStarted) throw new InvalidStateError('The purge already started and can no longer be cancelled');
      await this.deletions.clearPending(tx, tenantId);
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.tenantDeletionCancelled, targetTenantId: tenantId });
      return { tenantId, status: 'SUSPENDED', purgeAfter: null };
    });
  }
}
