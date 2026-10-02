import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { QuotaTerms, QuotaUsage } from '../domain/quota-policy.js';

/**
 * The tenant's storage counter. Every change goes through `lock` first: concurrent reservations of one tenant
 * queue on that row, and `FOR UPDATE` reads the latest committed values, so they can never jointly pass the limit.
 */
@Injectable()
export class TenantUsageRepository {
  async lock(tx: TenantTransaction, tenantId: string): Promise<QuotaUsage> {
    await tx.$executeRaw`INSERT INTO tenant_usage (tenant_id) VALUES (${tenantId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<Array<{ bytes_used: bigint; bytes_reserved: bigint }>>`
      SELECT bytes_used, bytes_reserved FROM tenant_usage WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
    return { usedBytes: row!.bytes_used, reservedBytes: row!.bytes_reserved };
  }

  /** Must run after `lock`. */
  async adjust(tx: TenantTransaction, tenantId: string, delta: { readonly reservedBytes?: bigint; readonly usedBytes?: bigint }): Promise<void> {
    await tx.$executeRaw`
      UPDATE tenant_usage
      SET bytes_reserved = bytes_reserved + ${delta.reservedBytes ?? 0n}, bytes_used = bytes_used + ${delta.usedBytes ?? 0n}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid`;
  }

  async termsOf(tx: TenantTransaction, tenantId: string): Promise<QuotaTerms> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { extraStorageBytes: true, plan: { select: { storageBaseBytes: true, storagePerUserBytes: true, storageGracePercent: true } } },
    });
    const activeUsers = await tx.membership.count({ where: { tenantId, status: 'ACTIVE', user: { status: { not: 'DISABLED' } } } });
    return {
      baseBytes: tenant.plan.storageBaseBytes,
      perUserBytes: tenant.plan.storagePerUserBytes,
      gracePercent: tenant.plan.storageGracePercent,
      extraBytes: tenant.extraStorageBytes,
      activeUsers,
    };
  }

  async read(tx: TenantTransaction, tenantId: string): Promise<QuotaUsage> {
    const usage = await tx.tenantUsage.findUnique({ where: { tenantId }, select: { bytesUsed: true, bytesReserved: true } });
    return { usedBytes: usage?.bytesUsed ?? 0n, reservedBytes: usage?.bytesReserved ?? 0n };
  }
}
