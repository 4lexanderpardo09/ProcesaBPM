import { Injectable } from '@nestjs/common';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

export interface LockedTenant {
  readonly name: string;
  readonly status: string;
  readonly purgeAfter: Date | null;
  readonly purgeStarted: boolean;
}

export const DELETION_PERIOD_DAYS = 30;

/** The state changes of a tenant's deletion. The tenant row is locked first, so a request and a cancel cannot interleave. */
@Injectable()
export class TenantDeletionRepository {
  async lock(tx: PlatformTransaction, tenantId: string): Promise<LockedTenant | undefined> {
    const [row] = await tx.$queryRaw<Array<{ name: string; status: string; purge_after: Date | null; purge_attempts: number }>>`
      SELECT name, status::text AS status, purge_after, purge_attempts FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    return row === undefined ? undefined : { name: row.name, status: row.status, purgeAfter: row.purge_after, purgeStarted: row.purge_attempts > 0 };
  }

  /** Returns when the purge becomes possible (database clock). */
  async markPending(tx: PlatformTransaction, tenantId: string, administratorId: string): Promise<Date> {
    const [row] = await tx.$queryRaw<Array<{ purge_after: Date }>>`
      UPDATE tenants
      SET status = 'PENDING_DELETION', deletion_requested_at = now(), deletion_requested_by_id = ${administratorId}::uuid,
          purge_after = now() + make_interval(days => ${DELETION_PERIOD_DAYS}::int),
          purge_attempts = 0, purge_lease_until = NULL, purge_retry_at = NULL, purge_last_error = NULL, purge_reminder_level = 0
      WHERE id = ${tenantId}::uuid
      RETURNING purge_after`;
    return row!.purge_after;
  }

  /** Back to SUSPENDED (never straight to ACTIVE): reactivating is its own, explicit step. */
  async clearPending(tx: PlatformTransaction, tenantId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE tenants
      SET status = 'SUSPENDED', deletion_requested_at = NULL, deletion_requested_by_id = NULL, purge_after = NULL,
          purge_attempts = 0, purge_lease_until = NULL, purge_retry_at = NULL, purge_last_error = NULL, purge_reminder_level = 0
      WHERE id = ${tenantId}::uuid`;
  }

  async revokeSessions(tx: PlatformTransaction, tenantId: string, at: Date): Promise<void> {
    await tx.refreshSession.updateMany({ where: { activeTenantId: tenantId, revokedAt: null }, data: { revokedAt: at } });
  }

  /** Support access ends with the tenant's life: the system revokes the grants and closes their visits. */
  async revokeSupportAccess(tx: PlatformTransaction, tenantId: string, at: Date): Promise<void> {
    await tx.supportAccessGrant.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: at, revokedById: null } });
    await tx.supportSession.updateMany({ where: { tenantId, closedAt: null }, data: { closedAt: at } });
  }

  async findOwnerUserId(tx: PlatformTransaction, tenantId: string): Promise<string | undefined> {
    const owner = await tx.membership.findFirst({ where: { tenantId, isOwner: true, status: 'ACTIVE' }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
    return owner?.userId;
  }
}
