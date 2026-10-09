import { Inject, Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type LockedUsage, TenantUsageRepository } from '../data/tenant-usage.repository.js';
import { quotaLimits, quotaWarningLevel } from '../domain/quota-policy.js';

/**
 * Keeps the announced storage warning in step with the usage after every change of the counter. Crossing 80 % or 95 %
 * of the plan's limit queues a `storage.quota` event (the notifications worker tells the owner and the administrators);
 * falling back below a threshold, or the limit growing, lowers the level without a word, so the next crossing is
 * announced again. Runs in the transaction that changed the counter, after `lock`.
 */
@Injectable()
export class QuotaWarningService {
  constructor(@Inject(TenantUsageRepository) private readonly usage: TenantUsageRepository) {}

  /** `usedBytes` is the stored total after the change; `before` is what `lock` returned. */
  async sync(tx: TenantTransaction, tenantId: string, before: LockedUsage, usedBytes: bigint): Promise<void> {
    const limits = quotaLimits(await this.usage.termsOf(tx, tenantId));
    const level = quotaWarningLevel(limits, usedBytes);
    if (level === before.warningLevel) return;
    await this.usage.setWarningLevel(tx, tenantId, level);
    if (level > before.warningLevel) await this.usage.queueWarning(tx, tenantId, { level: level as 80 | 95, usedBytes: usedBytes.toString(), limitBytes: limits.limitBytes.toString() });
  }
}
