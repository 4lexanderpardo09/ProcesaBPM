import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

/**
 * S4: a role can only be given permissions the actor already holds. A custom role with `update Role` used to
 * be able to hand out any permission except `manage all`.
 */
describe('role permission grants (S4)', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let editorId: string;
  let editorRoleId: string;
  let targetRoleId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    // A non-admin role that only holds `read Role`, and a member (the actor) sitting on it.
    editorRoleId = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, system_role) VALUES ($1, 'Role reader', 'SUPERVISOR') RETURNING id`, [
      tenant.tenantId,
    ]);
    await db.platform.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE action = 'read' AND subject = 'Role'`,
      [tenant.tenantId, editorRoleId],
    );
    editorId = await seedMember(db.platform, { tenantId: tenant.tenantId, roleId: editorRoleId, companyId: tenant.companyId }, 'editor');
    targetRoleId = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, system_role) VALUES ($1, 'Target', 'AGENT') RETURNING id`, [tenant.tenantId]);
  });
  afterAll(() => db.close());

  const grant = (actorId: string, roleId: string, action: string, subject: string) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId: actorId }, (client) =>
      client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id)
         SELECT $1, $2, id FROM permissions WHERE action = $3 AND subject = $4`,
        [tenant.tenantId, roleId, action, subject],
      ),
    );

  it('lets the actor delegate a permission they already hold', async () => {
    expect(await sqlStateOf(() => grant(editorId, targetRoleId, 'read', 'Role'))).toBeUndefined();
  });

  it('refuses to grant a permission the actor does not hold', async () => {
    expect(await sqlStateOf(() => grant(editorId, targetRoleId, 'delete', 'Role'))).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(() => grant(editorId, targetRoleId, 'manage', 'all'))).toBe(SqlState.insufficientPrivilege);
  });

  it('cannot grant itself more permissions', async () => {
    expect(await sqlStateOf(() => grant(editorId, editorRoleId, 'delete', 'Role'))).toBe(SqlState.insufficientPrivilege);
  });

  it('lets a full-access member (the administrator) grant anything', async () => {
    expect(await sqlStateOf(() => grant(tenant.userId, targetRoleId, 'delete', 'Role'))).toBeUndefined();
  });
});
