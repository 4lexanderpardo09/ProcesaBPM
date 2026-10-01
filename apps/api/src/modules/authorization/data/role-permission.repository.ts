import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RawPermissionRule } from '../domain/build-ability.js';

export interface LoadedRules {
  readonly version: number;
  readonly rules: RawPermissionRule[];
}

@Injectable()
export class RolePermissionRepository {
  /**
   * The rules of a role and the version they belong to, read together in one statement so that the
   * version never describes other rules. Row-level security keeps this to the current tenant;
   * `permissions` is the global catalog.
   */
  async loadRules(tx: TenantTransaction, tenantId: string, roleId: string): Promise<LoadedRules | undefined> {
    const role = await tx.role.findUnique({
      where: { tenantId_id: { tenantId, id: roleId } },
      select: { permissionsVersion: true, permissions: { select: { conditions: true, permission: { select: { action: true, subject: true } } } } },
    });
    if (role === null) return undefined;
    return {
      version: role.permissionsVersion,
      rules: role.permissions.map((row) => ({ action: row.permission.action, subject: row.permission.subject, conditions: row.conditions })),
    };
  }
}
