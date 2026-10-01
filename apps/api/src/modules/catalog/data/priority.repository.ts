import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PriorityRow {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly color: string | null;
  readonly isActive: boolean;
}

export interface PriorityWrite {
  readonly name?: string;
  readonly sortOrder?: number;
  readonly color?: string | null;
  readonly isActive?: boolean;
}

const SELECT = { id: true, name: true, sortOrder: true, color: true, isActive: true } as const;

@Injectable()
export class PriorityRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: PriorityRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([
      tx.priority.findMany({ where, select: SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.priority.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<PriorityRow | null> {
    return tx.priority.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { name: string; sortOrder?: number; color?: string }): Promise<PriorityRow> {
    return tx.priority.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: PriorityWrite): Promise<void> {
    await tx.priority.updateMany({ where: { tenantId, id }, data });
  }
}
