import { Injectable } from '@nestjs/common';
import type { FailedOutboxEvent, Page, PlatformMetrics } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

/** A tenant handler's error can quote the tenant's data (addresses, names): only the start of it is shown. */
const TENANT_ERROR_PREVIEW = 80;

@Injectable()
export class OperationsRepository {
  async listFailedPlatformEvents(tx: PlatformTransaction, page: number, pageSize: number): Promise<Page<FailedOutboxEvent>> {
    const rows = await tx.$queryRaw<Array<{ out_id: string; out_type: string; out_attempts: number; out_last_error: string | null; out_created_at: Date; out_total: bigint }>>`
      SELECT * FROM list_failed_platform_outbox_events(${pageSize}::int, ${(page - 1) * pageSize}::int)`;
    return {
      items: rows.map((row) => ({ scope: 'PLATFORM', tenantId: null, id: row.out_id, type: row.out_type, attempts: row.out_attempts, lastError: row.out_last_error, createdAt: row.out_created_at.toISOString() })),
      page,
      pageSize,
      total: Number(rows[0]?.out_total ?? 0),
    };
  }

  /** Selects columns one by one: the payload is never read. */
  async listFailedTenantEvents(tx: PlatformTransaction, page: number, pageSize: number): Promise<Page<FailedOutboxEvent>> {
    const where = { status: 'FAILED' } as const;
    const [rows, total] = await Promise.all([
      tx.outboxEvent.findMany({
        where,
        select: { tenantId: true, id: true, type: true, attempts: true, lastError: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.outboxEvent.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ scope: 'TENANT', tenantId: row.tenantId, id: row.id, type: row.type, attempts: row.attempts, lastError: row.lastError?.slice(0, TENANT_ERROR_PREVIEW) ?? null, createdAt: row.createdAt.toISOString() })),
      page,
      pageSize,
      total,
    };
  }

  async retryPlatformEvent(tx: PlatformTransaction, id: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT retry_failed_platform_outbox_event(${id}::uuid) AS ok`;
    return row!.ok;
  }

  async retryTenantEvent(tx: PlatformTransaction, tenantId: string, id: string): Promise<boolean> {
    const { count } = await tx.outboxEvent.updateMany({
      where: { tenantId, id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, availableAt: new Date(), lastError: null },
    });
    return count > 0;
  }

  async metrics(tx: PlatformTransaction, since: Date): Promise<PlatformMetrics> {
    const [byStatus, totalUsers, withMembership, usage, perDay] = await Promise.all([
      tx.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.user.count(),
      tx.user.count({ where: { memberships: { some: { status: 'ACTIVE' } } } }),
      tx.tenantUsage.aggregate({ _sum: { bytesUsed: true } }),
      tx.$queryRaw<Array<{ day: string; n: number }>>`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM tickets WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      tenantsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      users: { total: totalUsers, withActiveMembership: withMembership },
      storageUsedBytes: (usage._sum.bytesUsed ?? 0n).toString(),
      ticketsPerDay: perDay.map((row) => ({ date: row.day, count: row.n })),
    };
  }
}
