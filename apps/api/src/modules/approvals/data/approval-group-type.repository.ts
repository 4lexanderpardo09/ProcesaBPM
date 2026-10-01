import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface ApprovalGroupTypeRow {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
}

const SELECT = { id: true, name: true, isDefault: true, createdAt: true } as const;

@Injectable()
export class ApprovalGroupTypeRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: ApprovalGroupTypeRow[]; total: number }> {
    const where = { tenantId, ...(query.search === undefined ? {} : { name: { contains: query.search, mode: 'insensitive' as const } }) };
    const [rows, total] = await Promise.all([
      tx.approvalGroupType.findMany({ where, select: SELECT, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.approvalGroupType.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<ApprovalGroupTypeRow | null> {
    return tx.approvalGroupType.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, name: string): Promise<ApprovalGroupTypeRow> {
    return tx.approvalGroupType.create({ data: { tenantId, name }, select: SELECT });
  }

  async rename(tx: TenantTransaction, tenantId: string, id: string, name: string): Promise<void> {
    await tx.approvalGroupType.updateMany({ where: { tenantId, id }, data: { name } });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.approvalGroupType.deleteMany({ where: { tenantId, id } });
  }

  /** Groups and workflow steps that still use the type. */
  async countUsages(tx: TenantTransaction, tenantId: string, id: string): Promise<number> {
    const [groups, steps] = await Promise.all([
      tx.approvalGroup.count({ where: { tenantId, typeId: id } }),
      tx.step.count({ where: { tenantId, approvalGroupTypeId: id } }),
    ]);
    return groups + steps;
  }
}
