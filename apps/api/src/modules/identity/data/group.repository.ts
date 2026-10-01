import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

const SELECT = { id: true, name: true, isActive: true, createdAt: true } as const;

@Injectable()
export class GroupRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: GroupRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([
      tx.group.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      tx.group.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<GroupRow | null> {
    return tx.group.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, name: string): Promise<GroupRow> {
    return tx.group.create({ data: { tenantId, name }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.group.updateMany({ where: { tenantId, id }, data });
  }

  async findMemberIds(tx: TenantTransaction, tenantId: string, groupId: string): Promise<string[]> {
    const rows = await tx.groupMember.findMany({ where: { tenantId, groupId }, select: { userId: true }, orderBy: { userId: 'asc' } });
    return rows.map((row) => row.userId);
  }

  async addMember(tx: TenantTransaction, tenantId: string, groupId: string, userId: string): Promise<void> {
    await tx.groupMember.create({ data: { tenantId, groupId, userId } });
  }

  async removeMember(tx: TenantTransaction, tenantId: string, groupId: string, userId: string): Promise<boolean> {
    const { count } = await tx.groupMember.deleteMany({ where: { tenantId, groupId, userId } });
    return count > 0;
  }

  async replaceMembers(tx: TenantTransaction, tenantId: string, groupId: string, userIds: readonly string[]): Promise<void> {
    await tx.groupMember.deleteMany({ where: { tenantId, groupId } });
    await tx.groupMember.createMany({ data: userIds.map((userId) => ({ tenantId, groupId, userId })) });
  }
}
