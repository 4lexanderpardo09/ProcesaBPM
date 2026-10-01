import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RawPermissionRule } from '../domain/build-ability.js';

@Injectable()
export class RolePermissionRepository {
  /** Row-level security keeps this to the current tenant; `permissions` is the global catalog. */
  async loadRules(tx: TenantTransaction, roleId: string): Promise<RawPermissionRule[]> {
    const rows = await tx.rolePermission.findMany({
      where: { roleId },
      select: { conditions: true, permission: { select: { action: true, subject: true } } },
    });
    return rows.map((row) => ({ action: row.permission.action, subject: row.permission.subject, conditions: row.conditions }));
  }
}
