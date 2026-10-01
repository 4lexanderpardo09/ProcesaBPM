import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, TenantNotFoundError, type TenantStatusResponse } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { PlatformAuditRepository } from '../data/platform-audit.repository.js';
import { type ManagedTenantStatus, TenantRepository } from '../data/tenant.repository.js';
import { PLATFORM_AUDIT_ACTIONS } from '../domain/tenant-signup-policy.js';

/** Suspends or reactivates a tenant. Repeating the change is harmless; cancelled or deleted tenants are final. */
@Injectable()
export class TenantStatusService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(TenantRepository) private readonly tenants: TenantRepository,
    @Inject(PlatformAuditRepository) private readonly audit: PlatformAuditRepository,
  ) {}

  suspend(actorUserId: string, tenantId: string): Promise<TenantStatusResponse> {
    return this.change(actorUserId, tenantId, 'SUSPENDED', PLATFORM_AUDIT_ACTIONS.tenantSuspended);
  }

  reactivate(actorUserId: string, tenantId: string): Promise<TenantStatusResponse> {
    return this.change(actorUserId, tenantId, 'ACTIVE', PLATFORM_AUDIT_ACTIONS.tenantReactivated);
  }

  private change(actorUserId: string, tenantId: string, target: ManagedTenantStatus, action: string): Promise<TenantStatusResponse> {
    return this.runner.run(async (tx) => {
      const current = await this.tenants.lockStatus(tx, tenantId);
      if (current === undefined) throw new TenantNotFoundError();
      if (current !== 'ACTIVE' && current !== 'SUSPENDED') throw new InvalidStateError(`A ${current.toLowerCase()} tenant cannot change status`);
      if (current !== target) {
        await this.tenants.updateStatus(tx, tenantId, target);
        await this.audit.record(tx, { actorUserId, action, targetTenantId: tenantId });
      }
      return { tenantId, status: target };
    });
  }
}
