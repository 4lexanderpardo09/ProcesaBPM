import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface CandidateRow {
  readonly userId: string;
  readonly name: string;
  readonly siteId: string | null;
}

const ELIGIBLE = { status: 'ACTIVE', user: { status: { not: 'DISABLED' } } } as const;
const SELECT = { userId: true, siteId: true, user: { select: { firstName: true, lastName: true } } } as const;
type Selected = { userId: string; siteId: string | null; user: { firstName: string; lastName: string } };
const toRow = (row: Selected): CandidateRow => ({ userId: row.userId, siteId: row.siteId, name: `${row.user.firstName} ${row.user.lastName}`.trim() });

/** Who can be assigned to a step: active members of enabled users. Every query carries the tenant. */
@Injectable()
export class AssignmentCandidatesRepository {
  /** Members holding the position that belong to the company. */
  async byPosition(tx: TenantTransaction, tenantId: string, positionId: string, companyId: string): Promise<CandidateRow[]> {
    const rows = await tx.membership.findMany({ where: { tenantId, positionId, companies: { some: { companyId } }, ...ELIGIBLE }, select: SELECT, orderBy: { userId: 'asc' } });
    return rows.map(toRow);
  }

  async byUsers(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<CandidateRow[]> {
    if (userIds.length === 0) return [];
    const rows = await tx.membership.findMany({ where: { tenantId, userId: { in: [...userIds] }, ...ELIGIBLE }, select: SELECT, orderBy: { userId: 'asc' } });
    return rows.map(toRow);
  }

  /** Active members of the active groups. */
  async byGroups(tx: TenantTransaction, tenantId: string, groupIds: readonly string[]): Promise<CandidateRow[]> {
    if (groupIds.length === 0) return [];
    const rows = await tx.membership.findMany({
      where: { tenantId, groupMembers: { some: { groupId: { in: [...groupIds] }, group: { isActive: true } } }, ...ELIGIBLE },
      select: SELECT,
      orderBy: { userId: 'asc' },
    });
    return rows.map(toRow);
  }
}
