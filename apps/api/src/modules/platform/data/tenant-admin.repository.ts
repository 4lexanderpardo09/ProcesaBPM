import { Injectable } from '@nestjs/common';
import type { ListTenantsQuery, Page, TenantListItem } from '@procesabpm/shared';
import type { Prisma } from '@procesabpm/db';
import type { PlatformTransaction } from '../../../infrastructure/database/platform-transaction-runner.js';
import type { QuotaTerms, QuotaUsage } from '../../files/domain/quota-policy.js';

export interface TenantProfile {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantListItem['status'];
  readonly countryCode: string;
  readonly createdAt: Date;
  readonly extraStorageBytes: bigint;
  readonly plan: { readonly code: string; readonly name: string; readonly storageBaseBytes: bigint; readonly storagePerUserBytes: bigint; readonly storageGracePercent: number };
}

export interface OwnerSummary {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly membershipStatus: string;
}

const PROFILE_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  countryCode: true,
  createdAt: true,
  extraStorageBytes: true,
  plan: { select: { code: true, name: true, storageBaseBytes: true, storagePerUserBytes: true, storageGracePercent: true } },
} as const;

const toListItem = (row: TenantProfile): TenantListItem => ({
  tenantId: row.id,
  slug: row.slug,
  name: row.name,
  status: row.status,
  planCode: row.plan.code,
  countryCode: row.countryCode,
  createdAt: row.createdAt.toISOString(),
});

/** Reads and changes of a tenant as the platform sees it: counts and settings, never the tenant's business data. */
@Injectable()
export class TenantAdminRepository {
  async list(tx: PlatformTransaction, query: ListTenantsQuery): Promise<Page<TenantListItem>> {
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.planCode ? { plan: { code: query.planCode } } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { slug: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.tenant.findMany({ where, select: PROFILE_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.tenant.count({ where }),
    ]);
    return { items: rows.map(toListItem), page: query.page, pageSize: query.pageSize, total };
  }

  async findProfile(tx: PlatformTransaction, tenantId: string): Promise<TenantProfile | undefined> {
    const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: PROFILE_SELECT });
    return row ?? undefined;
  }

  async findOwner(tx: PlatformTransaction, tenantId: string): Promise<OwnerSummary | undefined> {
    const owner = await tx.membership.findFirst({
      where: { tenantId, isOwner: true },
      select: { status: true, user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return owner ? { ...owner.user, membershipStatus: owner.status } : undefined;
  }

  async findOwnerPendingInvitation(tx: PlatformTransaction, tenantId: string): Promise<string | undefined> {
    const owner = await tx.membership.findFirst({ where: { tenantId, isOwner: true, status: 'INVITED', user: { status: 'ACTIVE' } }, select: { userId: true } });
    return owner?.userId;
  }

  countCompanies(tx: PlatformTransaction, tenantId: string): Promise<number> {
    return tx.company.count({ where: { tenantId } });
  }

  countActiveUsers(tx: PlatformTransaction, tenantId: string): Promise<number> {
    return tx.membership.count({ where: { tenantId, status: 'ACTIVE', user: { status: { not: 'DISABLED' } } } });
  }

  countTicketsSince(tx: PlatformTransaction, tenantId: string, since: Date): Promise<number> {
    return tx.ticket.count({ where: { tenantId, createdAt: { gte: since } } });
  }

  async readUsage(tx: PlatformTransaction, tenantId: string): Promise<QuotaUsage> {
    const usage = await tx.tenantUsage.findUnique({ where: { tenantId }, select: { bytesUsed: true, bytesReserved: true } });
    return { usedBytes: usage?.bytesUsed ?? 0n, reservedBytes: usage?.bytesReserved ?? 0n };
  }

  /** Last thing a member did in this tenant: the newest audit entry or the newest session opened for it. */
  async lastActivity(tx: PlatformTransaction, tenantId: string): Promise<Date | undefined> {
    const [audit, login] = await Promise.all([
      tx.auditLog.findFirst({ where: { tenantId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
      tx.refreshSession.findFirst({ where: { activeTenantId: tenantId }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const instants = [audit?.createdAt, login?.createdAt].filter((value): value is Date => value instanceof Date);
    return instants.length === 0 ? undefined : new Date(Math.max(...instants.map((instant) => instant.getTime())));
  }

  /** Why and when the current suspension started: the latest audit entry of that action. */
  async lastSuspension(tx: PlatformTransaction, tenantId: string, action: string): Promise<{ reason: string; at: Date } | undefined> {
    const entry = await tx.platformAuditLog.findFirst({ where: { targetTenantId: tenantId, action }, select: { data: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    if (!entry) return undefined;
    const reason = (entry.data as { reason?: unknown } | null)?.reason;
    return { reason: typeof reason === 'string' ? reason : '', at: entry.createdAt };
  }

  quotaTermsOf(profile: TenantProfile, activeUsers: number): QuotaTerms {
    return {
      baseBytes: profile.plan.storageBaseBytes,
      perUserBytes: profile.plan.storagePerUserBytes,
      gracePercent: profile.plan.storageGracePercent,
      extraBytes: profile.extraStorageBytes,
      activeUsers,
    };
  }

  async findActivePlan(tx: PlatformTransaction, code: string): Promise<{ id: string; code: string; maxUsers: number | null } | undefined> {
    const plan = await tx.plan.findFirst({ where: { code, isActive: true }, select: { id: true, code: true, maxUsers: true } });
    return plan ?? undefined;
  }

  async lockProfile(tx: PlatformTransaction, tenantId: string): Promise<{ planCode: string; extraStorageBytes: bigint } | undefined> {
    const [row] = await tx.$queryRaw<Array<{ plan_code: string; extra_storage_bytes: bigint }>>`
      SELECT p.code AS plan_code, t.extra_storage_bytes
      FROM tenants t JOIN plans p ON p.id = t.plan_id
      WHERE t.id = ${tenantId}::uuid FOR UPDATE OF t`;
    return row ? { planCode: row.plan_code, extraStorageBytes: row.extra_storage_bytes } : undefined;
  }

  async updatePlan(tx: PlatformTransaction, tenantId: string, planId: string): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { planId } });
  }

  async updateExtraStorage(tx: PlatformTransaction, tenantId: string, extraStorageBytes: bigint): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { extraStorageBytes } });
  }
}
