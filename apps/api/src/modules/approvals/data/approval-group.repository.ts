import { Injectable } from '@nestjs/common';
import type { ApprovalGroupsQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface ApprovalGroupRow {
  readonly id: string;
  readonly typeId: string;
  readonly companyId: string | null;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

const SELECT = { id: true, typeId: true, companyId: true, name: true, isActive: true, createdAt: true } as const;

@Injectable()
export class ApprovalGroupRepository {
  async list(tx: TenantTransaction, tenantId: string, query: ApprovalGroupsQuery): Promise<{ rows: ApprovalGroupRow[]; total: number }> {
    const where = {
      tenantId,
      ...nameFilter(query),
      ...(query.typeId === undefined ? {} : { typeId: query.typeId }),
      ...(query.companyId === undefined ? {} : { companyId: query.companyId }),
    };
    const [rows, total] = await Promise.all([
      tx.approvalGroup.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      tx.approvalGroup.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<ApprovalGroupRow | null> {
    return tx.approvalGroup.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { typeId: string; companyId?: string; name: string }): Promise<ApprovalGroupRow> {
    return tx.approvalGroup.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.approvalGroup.updateMany({ where: { tenantId, id }, data });
  }

  async findApprovers(tx: TenantTransaction, tenantId: string, groupId: string): Promise<Array<{ userId: string; position: number }>> {
    return tx.approvalGroupApprover.findMany({ where: { tenantId, groupId }, select: { userId: true, position: true }, orderBy: { position: 'asc' } });
  }

  /** One operation: the list order becomes the positions 1..n. */
  async replaceApprovers(tx: TenantTransaction, tenantId: string, groupId: string, userIds: readonly string[]): Promise<void> {
    await tx.approvalGroupApprover.deleteMany({ where: { tenantId, groupId } });
    await tx.approvalGroupApprover.createMany({ data: userIds.map((userId, index) => ({ tenantId, groupId, userId, position: index + 1 })) });
  }

  async findMemberIds(tx: TenantTransaction, tenantId: string, groupId: string): Promise<string[]> {
    const rows = await tx.approvalGroupMember.findMany({ where: { tenantId, groupId }, select: { userId: true }, orderBy: { userId: 'asc' } });
    return rows.map((row) => row.userId);
  }

  /** The type and company of the member row are copied from the group by a database trigger. */
  async addMember(tx: TenantTransaction, tenantId: string, group: ApprovalGroupRow, userId: string): Promise<void> {
    await tx.approvalGroupMember.create({ data: { tenantId, groupId: group.id, typeId: group.typeId, companyId: group.companyId, userId } });
  }

  async removeMember(tx: TenantTransaction, tenantId: string, groupId: string, userId: string): Promise<boolean> {
    const { count } = await tx.approvalGroupMember.deleteMany({ where: { tenantId, groupId, userId } });
    return count > 0;
  }

  async replaceMembers(tx: TenantTransaction, tenantId: string, group: ApprovalGroupRow, userIds: readonly string[]): Promise<void> {
    await tx.approvalGroupMember.deleteMany({ where: { tenantId, groupId: group.id } });
    await tx.approvalGroupMember.createMany({ data: userIds.map((userId) => ({ tenantId, groupId: group.id, typeId: group.typeId, companyId: group.companyId, userId })) });
  }
}
