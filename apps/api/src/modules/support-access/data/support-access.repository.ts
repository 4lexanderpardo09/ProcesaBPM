import { Injectable } from '@nestjs/common';
import type { SupportGrantResponse } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

const HISTORY_SIZE = 20;

export interface NewGrant {
  readonly tenantId: string;
  readonly grantedById: string;
  readonly reason: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
}

type MemberName = { user: { firstName: string; lastName: string } };
const fullName = (member: MemberName) => `${member.user.firstName} ${member.user.lastName}`;
const MEMBER_SELECT = { select: { userId: true, user: { select: { firstName: true, lastName: true } } } } as const;

/** The tenant's own grants and the visits made under them, read and written in the tenant's transaction. */
@Injectable()
export class SupportAccessRepository {
  /** Revokes (as the system or a member) every grant not yet revoked and closes the visits under them. Returns how many grants. */
  async revokeInForce(tx: TenantTransaction, tenantId: string, at: Date, revokedById: string | null): Promise<string[]> {
    const open = await tx.supportAccessGrant.findMany({ where: { tenantId, revokedAt: null }, select: { id: true } });
    if (open.length === 0) return [];
    const ids = open.map((grant) => grant.id);
    await tx.supportAccessGrant.updateMany({ where: { tenantId, id: { in: ids } }, data: { revokedAt: at, revokedById } });
    await tx.supportSession.updateMany({ where: { tenantId, grantId: { in: ids }, closedAt: null }, data: { closedAt: at } });
    return ids;
  }

  async create(tx: TenantTransaction, grant: NewGrant): Promise<string> {
    const created = await tx.supportAccessGrant.create({ data: grant, select: { id: true } });
    return created.id;
  }

  async history(tx: TenantTransaction, tenantId: string, now: Date): Promise<SupportGrantResponse[]> {
    const grants = await tx.supportAccessGrant.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_SIZE,
      include: { grantedBy: { select: { userId: true, user: MEMBER_SELECT.select.user } }, revokedBy: { select: { userId: true, user: MEMBER_SELECT.select.user } }, sessions: { orderBy: { openedAt: 'asc' } } },
    });
    const requests = await tx.auditLog.groupBy({ by: ['supportGrantId'], where: { tenantId, supportGrantId: { in: grants.map((grant) => grant.id) } }, _count: { _all: true } });
    const countOf = new Map(requests.map((row) => [row.supportGrantId, row._count._all]));
    return grants.map((grant) => ({
      id: grant.id,
      status: grant.revokedAt !== null ? 'REVOKED' : grant.expiresAt > now ? 'ACTIVE' : 'EXPIRED',
      reason: grant.reason,
      grantedBy: { userId: grant.grantedBy.userId, name: fullName(grant.grantedBy) },
      startsAt: grant.startsAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      revokedBy: grant.revokedBy ? { userId: grant.revokedBy.userId, name: fullName(grant.revokedBy) } : null,
      visits: grant.sessions.map((visit) => ({ id: visit.id, administrator: visit.platformUserLabel, openedAt: visit.openedAt.toISOString(), closedAt: visit.closedAt?.toISOString() ?? null })),
      requests: countOf.get(grant.id) ?? 0,
    }));
  }

  /** Is the session the administrator is using one that passed the second factor? */
  async sessionMfaVerified(tx: TenantTransaction, sessionId: string): Promise<boolean> {
    const session = await tx.refreshSession.findUnique({ where: { id: sessionId }, select: { mfaVerified: true } });
    return session?.mfaVerified === true;
  }
}
