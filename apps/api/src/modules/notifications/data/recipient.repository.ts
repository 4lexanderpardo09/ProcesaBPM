import { Injectable } from '@nestjs/common';
import type { NotificationTypeValue } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { Channels } from '../domain/channels.js';

export interface MemberAccessFacts {
  readonly userId: string;
  readonly roleId: string;
  readonly roleActive: boolean;
  readonly roleIsAdmin: boolean;
  readonly isOwner: boolean;
  readonly membership: { readonly departmentId: string | null; readonly siteId: string | null; readonly positionId: string | null };
}

export interface MailRecipient {
  readonly email: string;
  readonly firstName: string;
}

/** What the worker needs to know about the people it may notify. */
@Injectable()
export class RecipientRepository {
  /** Active members of active accounts, with what decides what they may read. Anyone else is not returned. */
  async activeMembers(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<MemberAccessFacts[]> {
    if (userIds.length === 0) return [];
    const members = await tx.membership.findMany({
      where: { tenantId, userId: { in: [...userIds] }, status: 'ACTIVE', user: { status: { not: 'DISABLED' } } },
      select: { userId: true, roleId: true, isOwner: true, positionId: true, departmentId: true, siteId: true, role: { select: { isActive: true, isAdmin: true } } },
    });
    return members.map((member) => ({
      userId: member.userId,
      roleId: member.roleId,
      roleActive: member.role.isActive,
      roleIsAdmin: member.role.isAdmin,
      isOwner: member.isOwner,
      membership: { departmentId: member.departmentId, siteId: member.siteId, positionId: member.positionId },
    }));
  }

  /** The owner and the members with an active administrator role, among the active members of active accounts. */
  async administratorIds(tx: TenantTransaction, tenantId: string): Promise<string[]> {
    const members = await tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', user: { status: { not: 'DISABLED' } }, OR: [{ isOwner: true }, { role: { isAdmin: true, isActive: true } }] },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    return members.map((member) => member.userId);
  }

  async preferences(tx: TenantTransaction, tenantId: string, userIds: readonly string[], types: readonly NotificationTypeValue[]): Promise<Map<string, Channels>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.notificationPreference.findMany({ where: { tenantId, userId: { in: [...userIds] }, type: { in: [...types] } }, select: { userId: true, type: true, inApp: true, email: true } });
    return new Map(rows.map((row) => [`${row.userId}:${row.type}`, { inApp: row.inApp, email: row.email }]));
  }

  async mailRecipient(tx: TenantTransaction, userId: string): Promise<MailRecipient | undefined> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
    return user ?? undefined;
  }
}
