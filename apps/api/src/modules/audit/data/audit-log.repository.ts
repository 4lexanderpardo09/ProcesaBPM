import { Injectable } from '@nestjs/common';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface NewAuditRow {
  readonly tenantId: string;
  /** Empty for a support visit: a platform administrator is not a member. */
  readonly actorId: string | null;
  readonly supportActorId?: string | null;
  readonly supportGrantId?: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export interface AuditFilter {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly actorId?: string | undefined;
  /** An exact action, or a prefix ending in a dot (`role.`). */
  readonly action?: string | undefined;
  readonly subjectType?: string | undefined;
  readonly subjectId?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface AuditLogRow {
  readonly id: string;
  readonly at: Date;
  readonly actor: { readonly id: string; readonly name: string } | null;
  /** The grant under which a platform administrator did it, when it was support. */
  readonly supportGrantId: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

const asJson = (value: unknown) => (value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

/** `audit_logs`: insert-only for every application login; this repository never updates or deletes. */
@Injectable()
export class AuditLogRepository {
  async insert(tx: TenantTransaction, row: NewAuditRow): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: row.tenantId,
        actorId: row.actorId,
        supportActorId: row.supportActorId ?? null,
        supportGrantId: row.supportGrantId ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: asJson(row.before),
        after: asJson(row.after),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        requestId: row.requestId,
      },
      select: { id: true },
    });
  }

  /** One more row than `limit` comes back when there is a next page. */
  async find(tx: TenantTransaction, filter: AuditFilter): Promise<AuditLogRow[]> {
    const rows = await tx.auditLog.findMany({
      where: {
        tenantId: filter.tenantId,
        createdAt: { gte: filter.from, lte: filter.to },
        ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
        ...(filter.action === undefined ? {} : filter.action.endsWith('.') ? { action: { startsWith: filter.action } } : { action: filter.action }),
        ...(filter.subjectType === undefined ? {} : { entityType: filter.subjectType }),
        ...(filter.subjectId === undefined ? {} : { entityId: filter.subjectId }),
        ...(filter.cursor === undefined ? {} : { id: { lt: filter.cursor } }),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
      include: { actor: { select: { user: { select: { id: true, firstName: true, lastName: true } } } } },
    });
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt,
      actor: row.actor === null ? null : { id: row.actor.user.id, name: `${row.actor.user.firstName} ${row.actor.user.lastName}` },
      supportGrantId: row.supportGrantId,
      action: row.action,
      subjectType: row.entityType,
      subjectId: row.entityId,
      before: row.before,
      after: row.after,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
    }));
  }
}
