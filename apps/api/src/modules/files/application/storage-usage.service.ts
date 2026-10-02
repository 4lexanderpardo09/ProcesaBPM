import { Inject, Injectable } from '@nestjs/common';
import type { StorageUsageResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { quotaLimits, storageState } from '../domain/quota-policy.js';

@Injectable()
export class StorageUsageService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository,
  ) {}

  get(): Promise<StorageUsageResponse> {
    const { tenantId } = this.context.require();
    return this.runner.withTenantTransaction(async (tx) => {
      const terms = await this.usage.termsOf(tx, tenantId);
      const used = await this.usage.read(tx, tenantId);
      const limits = quotaLimits(terms);
      return {
        usedBytes: used.usedBytes.toString(),
        reservedBytes: used.reservedBytes.toString(),
        limitBytes: limits.limitBytes.toString(),
        hardLimitBytes: limits.hardLimitBytes.toString(),
        activeUsers: terms.activeUsers,
        state: storageState(limits, used),
      };
    });
  }
}
