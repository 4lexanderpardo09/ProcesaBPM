import { Inject, Injectable } from '@nestjs/common';
import {
  type ChangeTenantPlanRequest,
  InvalidReferenceError,
  InvalidStateError,
  type ListTenantsQuery,
  type Page,
  type SetExtraStorageRequest,
  TenantNotFoundError,
  type TenantDetail,
  type TenantListItem,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { applyDatabaseScope } from '../../../infrastructure/database/database-scope.js';
import { PlatformTransactionRunner, type PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';
import { INVITATION_EVENT } from '../../../infrastructure/outbox/platform-event-types.js';
import { PlatformOutboxRepository } from '../../../infrastructure/outbox/platform-outbox.repository.js';
import { quotaLimits, storageState } from '../../files/domain/quota-policy.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { TenantAdminRepository } from '../data/tenant-admin.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

const ACTIVITY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the platform console shows and changes about a tenant: aggregates and commercial settings only. */
@Injectable()
export class TenantAdminService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(TenantAdminRepository) private readonly tenants: TenantAdminRepository,
    @Inject(PlatformOutboxRepository) private readonly outbox: PlatformOutboxRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  list(query: ListTenantsQuery): Promise<Page<TenantListItem>> {
    return this.runner.run((tx) => this.tenants.list(tx, query));
  }

  detail(tenantId: string): Promise<TenantDetail> {
    return this.runner.run((tx) => this.readDetail(tx, tenantId));
  }

  changePlan(actorUserId: string, tenantId: string, request: ChangeTenantPlanRequest): Promise<TenantDetail> {
    return this.runner.run(async (tx) => {
      const current = await this.tenants.lockProfile(tx, tenantId);
      if (current === undefined) throw new TenantNotFoundError();
      if (current.status === 'PURGED') throw new InvalidStateError('A purged tenant cannot change');
      const plan = await this.tenants.findActivePlan(tx, request.planCode);
      if (plan === undefined) throw new InvalidReferenceError(`Unknown or inactive plan ${request.planCode}`);
      if (plan.code !== current.planCode) {
        const activeUsers = await this.tenants.countActiveUsers(tx, tenantId);
        if (plan.maxUsers !== null && activeUsers > plan.maxUsers) throw new InvalidStateError(`The plan allows ${plan.maxUsers} users and the tenant has ${activeUsers}`);
        await this.tenants.updatePlan(tx, tenantId, plan.id);
        await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.tenantPlanChanged, targetTenantId: tenantId, data: { from: current.planCode, to: plan.code } });
      }
      return this.readDetail(tx, tenantId);
    });
  }

  setExtraStorage(actorUserId: string, tenantId: string, request: SetExtraStorageRequest): Promise<TenantDetail> {
    return this.runner.run(async (tx) => {
      const current = await this.tenants.lockProfile(tx, tenantId);
      if (current === undefined) throw new TenantNotFoundError();
      if (current.status === 'PURGED') throw new InvalidStateError('A purged tenant cannot change');
      const next = BigInt(request.extraStorageBytes);
      if (next !== current.extraStorageBytes) {
        await this.tenants.updateExtraStorage(tx, tenantId, next);
        await this.audit.record(tx, {
          actorUserId,
          action: PLATFORM_AUDIT_ACTIONS.tenantExtraStorageChanged,
          targetTenantId: tenantId,
          data: { from: current.extraStorageBytes.toString(), to: next.toString() },
        });
      }
      return this.readDetail(tx, tenantId);
    });
  }

  /** Queues a new invitation e-mail for an owner who has not accepted yet (the worker issues a fresh link). */
  resendOwnerInvitation(actorUserId: string, tenantId: string): Promise<void> {
    return this.runner.run(async (tx) => {
      if ((await this.tenants.findProfile(tx, tenantId)) === undefined) throw new TenantNotFoundError();
      const userId = await this.tenants.findOwnerPendingInvitation(tx, tenantId);
      if (userId === undefined) throw new InvalidStateError('The owner has no pending invitation');
      if ((await this.tenants.findProfile(tx, tenantId))!.status !== 'ACTIVE') throw new InvalidStateError('Invitations are only sent for active tenants');
      await applyDatabaseScope(tx, { tenantId, userId: '' });
      await this.outbox.enqueue(tx, INVITATION_EVENT, { tenantId, userId });
      await this.audit.record(tx, { actorUserId, action: PLATFORM_AUDIT_ACTIONS.tenantOwnerInvitationResent, targetTenantId: tenantId, data: { userId } });
    });
  }

  private async readDetail(tx: PlatformTransaction, tenantId: string): Promise<TenantDetail> {
    const profile = await this.tenants.findProfile(tx, tenantId);
    if (profile === undefined) throw new TenantNotFoundError();
    const since = new Date(this.clock.now().getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);
    const [owner, companies, activeUsers, tickets, usage, activity] = await Promise.all([
      this.tenants.findOwner(tx, tenantId),
      this.tenants.countCompanies(tx, tenantId),
      this.tenants.countActiveUsers(tx, tenantId),
      this.tenants.countTicketsSince(tx, tenantId, since),
      this.tenants.readUsage(tx, tenantId),
      this.tenants.lastActivity(tx, tenantId),
    ]);
    const limits = quotaLimits(this.tenants.quotaTermsOf(profile, activeUsers));
    const suspension = profile.status === 'SUSPENDED' ? await this.tenants.lastSuspension(tx, tenantId, PLATFORM_AUDIT_ACTIONS.tenantSuspended) : undefined;
    return {
      tenantId: profile.id,
      slug: profile.slug,
      name: profile.name,
      status: profile.status,
      planCode: profile.plan.code,
      countryCode: profile.countryCode,
      createdAt: profile.createdAt.toISOString(),
      plan: { code: profile.plan.code, name: profile.plan.name },
      owner: owner ?? null,
      companies,
      activeUsers,
      storage: {
        usedBytes: usage.usedBytes.toString(),
        reservedBytes: usage.reservedBytes.toString(),
        extraBytes: profile.extraStorageBytes.toString(),
        limitBytes: limits.limitBytes.toString(),
        hardLimitBytes: limits.hardLimitBytes.toString(),
        state: storageState(limits, usage),
      },
      ticketsLast30Days: tickets,
      lastActivityAt: activity?.toISOString() ?? null,
      suspension: suspension ? { reason: suspension.reason, at: suspension.at.toISOString() } : null,
      deletion: profile.deletionRequestedAt === null ? null : { requestedAt: profile.deletionRequestedAt.toISOString(), purgeAfter: profile.purgeAfter?.toISOString() ?? null, purgedAt: profile.purgedAt?.toISOString() ?? null },
    };
  }
}
