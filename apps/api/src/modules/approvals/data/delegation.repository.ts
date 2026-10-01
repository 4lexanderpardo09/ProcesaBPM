import { Injectable } from '@nestjs/common';
import type { DelegationsQuery } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface DelegationRow {
  readonly id: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly reason: string | null;
  readonly createdAt: Date;
}

const SELECT = { id: true, fromUserId: true, toUserId: true, startsAt: true, endsAt: true, reason: true, createdAt: true } as const;

@Injectable()
export class DelegationRepository {
  /** `involving` narrows the listing to the delegations of one person (as delegator or delegate). */
  async list(tx: TenantTransaction, tenantId: string, query: DelegationsQuery, options: { involving?: string; now: Date }): Promise<{ rows: DelegationRow[]; total: number }> {
    const where = {
      tenantId,
      ...(query.fromUserId === undefined ? {} : { fromUserId: query.fromUserId }),
      ...(query.toUserId === undefined ? {} : { toUserId: query.toUserId }),
      ...(query.current ? { endsAt: { gt: options.now } } : {}),
      ...(options.involving === undefined ? {} : { OR: [{ fromUserId: options.involving }, { toUserId: options.involving }] }),
    };
    const [rows, total] = await Promise.all([
      tx.delegation.findMany({ where, select: SELECT, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }], ...pageWindow(query) }),
      tx.delegation.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<DelegationRow | null> {
    return tx.delegation.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { fromUserId: string; toUserId: string; startsAt: Date; endsAt: Date; reason?: string }): Promise<DelegationRow> {
    return tx.delegation.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.delegation.deleteMany({ where: { tenantId, id } });
  }

  async endAt(tx: TenantTransaction, tenantId: string, id: string, endsAt: Date): Promise<void> {
    await tx.delegation.updateMany({ where: { tenantId, id }, data: { endsAt } });
  }
}
