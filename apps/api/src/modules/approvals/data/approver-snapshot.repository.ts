import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { ApprovalSnapshot, DelegationSnapshot, GroupSnapshot } from '../domain/resolve-approver.js';

interface Eligibility {
  readonly status: string;
  readonly user: { readonly status: string };
}

/** An active member whose account is not disabled (a temporarily locked account is still an approver). */
const isEligible = (membership: Eligibility | null): boolean => membership !== null && membership.status === 'ACTIVE' && membership.user.status !== 'DISABLED';

const ELIGIBILITY = { select: { status: true, user: { select: { status: true } } } } as const;

/** Loads what the resolver needs for one (type, company, instant) in three queries, whatever the number of levels. */
@Injectable()
export class ApproverSnapshotRepository {
  async load(tx: TenantTransaction, tenantId: string, scope: { creatorId: string; typeId: string; companyId: string; at: Date }): Promise<ApprovalSnapshot> {
    const groupRows = await tx.approvalGroup.findMany({
      where: { tenantId, typeId: scope.typeId, OR: [{ companyId: scope.companyId }, { companyId: null }] },
      select: { id: true, companyId: true, isActive: true, approvers: { select: { userId: true, position: true, membership: ELIGIBILITY }, orderBy: { position: 'asc' } } },
    });
    const approverIds = [...new Set(groupRows.flatMap((group) => group.approvers.map((approver) => approver.userId)))];

    const [delegationRows, memberRows] = await Promise.all([
      tx.delegation.findMany({
        where: { tenantId, fromUserId: { in: approverIds }, startsAt: { lte: scope.at }, endsAt: { gt: scope.at } },
        select: { fromUserId: true, toUserId: true, toUser: ELIGIBILITY },
      }),
      tx.approvalGroupMember.findMany({
        where: { tenantId, typeId: scope.typeId, userId: { in: [scope.creatorId, ...approverIds] }, OR: [{ companyId: scope.companyId }, { companyId: null }] },
        select: { userId: true, groupId: true, companyId: true },
      }),
    ]);

    const groups = new Map<string, GroupSnapshot>(
      groupRows.map((group) => [
        group.id,
        {
          id: group.id,
          scope: group.companyId === null ? 'GENERAL' : 'COMPANY',
          active: group.isActive,
          approvers: group.approvers.map((approver) => ({ userId: approver.userId, position: approver.position, eligible: isEligible(approver.membership) })),
        },
      ]),
    );
    const delegations = new Map<string, DelegationSnapshot>(delegationRows.map((row) => [row.fromUserId, { toUserId: row.toUserId, toEligible: isEligible(row.toUser) }]));
    const memberGroups = new Map<string, { company?: string; general?: string }>();
    for (const row of memberRows) {
      const entry = memberGroups.get(row.userId) ?? {};
      memberGroups.set(row.userId, row.companyId === null ? { ...entry, general: row.groupId } : { ...entry, company: row.groupId });
    }
    return { memberGroups, groups, delegations };
  }

  /** Existence checks for the diagnostic endpoint: ids of another tenant answer like unknown ones. */
  async existence(tx: TenantTransaction, tenantId: string, ids: { userId: string; typeId: string; companyId: string }): Promise<{ user: boolean; type: boolean; company: boolean }> {
    const [user, type, company] = await Promise.all([
      tx.membership.count({ where: { tenantId, userId: ids.userId } }),
      tx.approvalGroupType.count({ where: { tenantId, id: ids.typeId } }),
      tx.company.count({ where: { tenantId, id: ids.companyId } }),
    ]);
    return { user: user > 0, type: type > 0, company: company > 0 };
  }
}
