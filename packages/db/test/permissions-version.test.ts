import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('roles.permissions_version', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let permissionIds: string[];

  const versionOf = async (roleId: string) =>
    (await db.owner.query<{ permissions_version: number }>('SELECT permissions_version FROM roles WHERE id = $1', [roleId])).rows[0]!.permissions_version;
  const newRole = (name: string) => insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenant.tenantId, name]);
  const grant = (roleId: string, permissionId: string) =>
    db.platform.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)', [tenant.tenantId, roleId, permissionId]);

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    permissionIds = (await db.owner.query<{ id: string }>(`SELECT id FROM permissions WHERE subject = 'Company' ORDER BY action LIMIT 3`)).rows.map((row) => row.id);
  });

  afterAll(async () => {
    await db.close();
  });

  it('starts at 0', async () => {
    expect(await versionOf(await newRole('Fresh'))).toBe(0);
  });

  it('grows with every insert, update and delete in role_permissions', async () => {
    const role = await newRole('Changing');
    await grant(role, permissionIds[0]!);
    expect(await versionOf(role)).toBe(1);
    await db.platform.query('UPDATE role_permissions SET conditions = $1::jsonb WHERE tenant_id = $2 AND role_id = $3', ['{"a":1}', tenant.tenantId, role]);
    expect(await versionOf(role)).toBe(2);
    await db.platform.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant.tenantId, role]);
    expect(await versionOf(role)).toBe(3);
  });

  it('counts each row of a bulk change', async () => {
    const role = await newRole('Bulk');
    await db.platform.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, unnest($3::uuid[])', [tenant.tenantId, role, permissionIds]);
    expect(await versionOf(role)).toBe(permissionIds.length);
  });

  it('moving a row to another role bumps both roles', async () => {
    const [from, to] = [await newRole('From'), await newRole('To')];
    await grant(from, permissionIds[0]!);
    const [fromBefore, toBefore] = [await versionOf(from), await versionOf(to)];
    await db.platform.query('UPDATE role_permissions SET role_id = $1 WHERE tenant_id = $2 AND role_id = $3', [to, tenant.tenantId, from]);
    expect(await versionOf(from)).toBeGreaterThan(fromBefore);
    expect(await versionOf(to)).toBeGreaterThan(toBefore);
  });

  it('a change made by the API role (under RLS) bumps the version too', async () => {
    const role = await newRole('ByApi');
    const before = await versionOf(role);
    const client = await db.runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [tenant.tenantId, tenant.userId]);
      await client.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)', [tenant.tenantId, role, permissionIds[1]]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await versionOf(role)).toBe(before + 1);
  });

  it('never goes down (a stale cache entry must not become valid again)', async () => {
    const role = await newRole('Monotonic');
    await grant(role, permissionIds[0]!);
    expect(await sqlStateOf(() => db.platform.query('UPDATE roles SET permissions_version = 0 WHERE id = $1', [role]))).toBe(SqlState.checkViolation);
    await db.platform.query('UPDATE roles SET permissions_version = permissions_version + 5 WHERE id = $1', [role]);
  });

  it('deleting a role with permissions, and purging a tenant, still work', async () => {
    const role = await newRole('Doomed');
    await grant(role, permissionIds[0]!);
    await db.platform.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant.tenantId, role]);
    await db.platform.query('DELETE FROM roles WHERE id = $1', [role]);

    const other = await seedTenant(db.platform);
    const otherRole = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, 'Purged') RETURNING id`, [other.tenantId]);
    await db.platform.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)', [other.tenantId, otherRole, permissionIds[0]]);
    await db.platform.query('SELECT purge_tenant($1)', [other.tenantId]);
    expect((await db.owner.query('SELECT 1 FROM roles WHERE tenant_id = $1', [other.tenantId])).rowCount).toBe(0);
  });
});
