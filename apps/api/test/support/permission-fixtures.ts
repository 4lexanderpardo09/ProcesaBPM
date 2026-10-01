import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, type SeededTenant, withPlatformTransaction } from '@procesabpm/db/testing/fixtures';

export interface GrantedPermission {
  readonly action: string;
  readonly subject: string;
  readonly conditions?: unknown;
}

/** Ensures the catalog has the permission and returns its id (the catalog is global). */
async function catalogId(db: TestDatabase, action: string, subject: string): Promise<string> {
  const existing = await db.owner.query<{ id: string }>('SELECT id FROM permissions WHERE action = $1 AND subject = $2', [action, subject]);
  if (existing.rows[0] !== undefined) return existing.rows[0].id;
  return insertReturningId(db.owner, 'INSERT INTO permissions (action, subject) VALUES ($1, $2) RETURNING id', [action, subject]);
}

/** Replaces the permissions of a role (as the identity module will do), without touching the cache. */
export async function setRolePermissions(db: TestDatabase, tenantId: string, roleId: string, granted: readonly GrantedPermission[]): Promise<void> {
  const ids = await Promise.all(granted.map((permission) => catalogId(db, permission.action, permission.subject)));
  await withPlatformTransaction(db.platform, async (tx) => {
    await tx.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenantId, roleId]);
    for (const [index, permission] of granted.entries()) {
      await tx.query(
        'INSERT INTO role_permissions (tenant_id, role_id, permission_id, conditions) VALUES ($1, $2, $3, $4::jsonb)',
        [tenantId, roleId, ids[index], permission.conditions === undefined ? null : JSON.stringify(permission.conditions)],
      );
    }
  });
}

export const grantEverything = (db: TestDatabase, tenant: SeededTenant) =>
  setRolePermissions(db, tenant.tenantId, tenant.roleId, [{ action: 'manage', subject: 'all' }]);

/** Another role of the tenant, and a member that has it. */
export async function seedRole(db: TestDatabase, tenantId: string, name: string, options: { isActive?: boolean } = {}): Promise<string> {
  return insertReturningId(
    db.platform,
    `INSERT INTO roles (tenant_id, name, is_active) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, options.isActive ?? true],
  );
}
