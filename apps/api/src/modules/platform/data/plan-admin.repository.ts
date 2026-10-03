import { Injectable } from '@nestjs/common';
import type { PlanSummary, UpdatePlanRequest } from '@procesabpm/shared';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';

type PlanRow = {
  code: string;
  name: string;
  storageBaseBytes: bigint;
  storagePerUserBytes: bigint;
  storageGracePercent: number;
  maxUsers: number | null;
  isActive: boolean;
  _count: { tenants: number };
};

const SELECT = {
  code: true,
  name: true,
  storageBaseBytes: true,
  storagePerUserBytes: true,
  storageGracePercent: true,
  maxUsers: true,
  isActive: true,
  _count: { select: { tenants: true } },
} as const;

const toSummary = (row: PlanRow): PlanSummary => ({
  code: row.code,
  name: row.name,
  storageBaseBytes: row.storageBaseBytes.toString(),
  storagePerUserBytes: row.storagePerUserBytes.toString(),
  storageGracePercent: row.storageGracePercent,
  maxUsers: row.maxUsers,
  isActive: row.isActive,
  tenants: row._count.tenants,
});

@Injectable()
export class PlanAdminRepository {
  async list(tx: PlatformTransaction): Promise<PlanSummary[]> {
    const rows = await tx.plan.findMany({ select: SELECT, orderBy: [{ storageBaseBytes: 'asc' }, { code: 'asc' }] });
    return rows.map(toSummary);
  }

  async find(tx: PlatformTransaction, code: string): Promise<PlanSummary | undefined> {
    const row = await tx.plan.findUnique({ where: { code }, select: SELECT });
    return row ? toSummary(row) : undefined;
  }

  async update(tx: PlatformTransaction, code: string, change: UpdatePlanRequest): Promise<void> {
    await tx.plan.update({
      where: { code },
      data: {
        ...(change.name !== undefined ? { name: change.name } : {}),
        ...(change.storageBaseBytes !== undefined ? { storageBaseBytes: BigInt(change.storageBaseBytes) } : {}),
        ...(change.storagePerUserBytes !== undefined ? { storagePerUserBytes: BigInt(change.storagePerUserBytes) } : {}),
        ...(change.storageGracePercent !== undefined ? { storageGracePercent: change.storageGracePercent } : {}),
        ...(change.maxUsers !== undefined ? { maxUsers: change.maxUsers } : {}),
      },
    });
  }
}
