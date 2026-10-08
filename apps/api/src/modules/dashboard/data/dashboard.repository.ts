import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PendingTicketRow {
  readonly id: string;
  readonly number: bigint;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly currentStepId: string | null;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
}

/** Every query carries the access filter (the tickets the caller may read) on top of the tenant. */
@Injectable()
export class DashboardRepository {
  count(tx: TenantTransaction, tenantId: string, filters: readonly Record<string, unknown>[]): Promise<number> {
    return tx.ticket.count({ where: { AND: [{ tenantId, deletedAt: null }, ...filters] } as never });
  }

  async pending(tx: TenantTransaction, tenantId: string, userId: string, access: Record<string, unknown>, take: number): Promise<PendingTicketRow[]> {
    const rows = await tx.ticket.findMany({
      where: { AND: [{ tenantId, deletedAt: null, status: { in: ['OPEN', 'PAUSED'] }, assignees: { some: { tenantId, userId } } }, access] } as never,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        currentStepId: true,
        createdAt: true,
        slaClocks: { where: { responsibleId: userId, completedAt: null, pausedAt: null }, select: { dueAt: true }, orderBy: { startedAt: 'desc' }, take: 1 },
      },
      orderBy: { number: 'desc' },
      take,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      status: row.status,
      currentStepId: row.currentStepId,
      createdAt: row.createdAt,
      dueAt: row.slaClocks[0]?.dueAt ?? null,
    }));
  }
}
