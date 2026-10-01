import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly systemRole: 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'REQUESTER' | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface RoleWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly isAdmin?: boolean;
  readonly isActive?: boolean;
}

export interface CatalogPermissionRow {
  readonly id: string;
  readonly action: string;
  readonly subject: string;
  readonly description: string | null;
}

export interface RolePermissionRow {
  readonly action: string;
  readonly subject: string;
  readonly conditions: unknown;
}

const SELECT = { id: true, name: true, description: true, systemRole: true, isAdmin: true, isActive: true, createdAt: true } as const;

@Injectable()
export class RoleRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: RoleRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([
      tx.role.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      tx.role.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<RoleRow | null> {
    return tx.role.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { name: string; description?: string; isAdmin?: boolean }): Promise<RoleRow> {
    return tx.role.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: RoleWrite): Promise<void> {
    await tx.role.updateMany({ where: { tenantId, id }, data });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.role.deleteMany({ where: { tenantId, id } });
  }

  countMembers(tx: TenantTransaction, tenantId: string, roleId: string): Promise<number> {
    return tx.membership.count({ where: { tenantId, roleId } });
  }

  findCatalog(tx: TenantTransaction): Promise<CatalogPermissionRow[]> {
    return tx.permission.findMany({ select: { id: true, action: true, subject: true, description: true }, orderBy: [{ subject: 'asc' }, { action: 'asc' }] });
  }

  async findPermissions(tx: TenantTransaction, tenantId: string, roleId: string): Promise<RolePermissionRow[]> {
    const rows = await tx.rolePermission.findMany({
      where: { tenantId, roleId },
      select: { conditions: true, permission: { select: { action: true, subject: true } } },
    });
    return rows
      .map((row) => ({ action: row.permission.action, subject: row.permission.subject, conditions: row.conditions }))
      .sort((a, b) => `${a.subject} ${a.action}`.localeCompare(`${b.subject} ${b.action}`));
  }

  /** One operation: the old list goes and the new one comes in (the version trigger bumps on every row). */
  async replacePermissions(
    tx: TenantTransaction,
    tenantId: string,
    roleId: string,
    grants: ReadonlyArray<{ permissionId: string; conditions: Record<string, unknown> | null }>,
  ): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { tenantId, roleId } });
    await tx.rolePermission.createMany({
      data: grants.map((grant) => ({
        tenantId,
        roleId,
        permissionId: grant.permissionId,
        // JSON null is not SQL NULL in Prisma: an absent condition is stored as SQL NULL.
        ...(grant.conditions === null ? {} : { conditions: grant.conditions as Prisma.InputJsonObject }),
      })),
    });
  }
}
