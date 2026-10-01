import type { Prisma } from '@procesabpm/db';
import { Injectable } from '@nestjs/common';

export type PlatformTransaction = Prisma.TransactionClient;

export interface NewRole {
  readonly systemRole: 'ADMIN' | 'SUPERVISOR' | 'AGENT' | 'REQUESTER';
  readonly name: string;
  readonly isAdmin: boolean;
}

export interface CatalogEntry {
  readonly id: string;
  readonly action: string;
  readonly subject: string;
}

/**
 * Runs on a platform transaction, which bypasses row-level security: every row is written with an
 * explicit `tenantId`, since nothing else guards against a wrong one.
 */
@Injectable()
export class TenantRoleRepository {
  findCatalog(tx: PlatformTransaction): Promise<CatalogEntry[]> {
    return tx.permission.findMany({ select: { id: true, action: true, subject: true } });
  }

  async createRoles(tx: PlatformTransaction, tenantId: string, roles: readonly NewRole[]): Promise<Array<{ id: string; systemRole: NewRole['systemRole'] }>> {
    const created = await tx.role.createManyAndReturn({
      data: roles.map((role) => ({ tenantId, ...role })),
      select: { id: true, systemRole: true },
    });
    return created.map((role) => ({ id: role.id, systemRole: role.systemRole! }));
  }

  async createRolePermissions(
    tx: PlatformTransaction,
    tenantId: string,
    grants: ReadonlyArray<{ roleId: string; permissionId: string }>,
  ): Promise<void> {
    await tx.rolePermission.createMany({ data: grants.map((grant) => ({ tenantId, ...grant })) });
  }
}
