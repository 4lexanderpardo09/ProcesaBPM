import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant, withPlatformTransaction } from './support/fixtures.js';

describe('owner and admin rules', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });

  afterAll(async () => {
    await db.close();
  });

  /** A tenant whose seeded administrator is also its (ACTIVE) owner. */
  async function ownedTenant() {
    const tenant = await seedTenant(db.platform);
    await db.platform.query('UPDATE memberships SET is_owner = true, joined_at = now() WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
    return tenant;
  }
  const nonAdminRole = (tenant: SeededTenant, name = 'Staff') =>
    insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, is_admin) VALUES ($1, $2, false) RETURNING id`, [tenant.tenantId, name]);
  const adminRole = (tenant: SeededTenant, name = 'Second admin') =>
    insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, is_admin) VALUES ($1, $2, true) RETURNING id`, [tenant.tenantId, name]);
  const asMember = <T>(tenant: SeededTenant, userId: string, work: Parameters<typeof withContext<T>>[2]) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId }, work);

  /** Runs the statements in one transaction and returns the SQLSTATE it fails with, and whether the statements themselves passed. */
  async function failsAtCommit(statements: Array<[string, unknown[]]>): Promise<{ statementsPassed: boolean; code: string | undefined }> {
    const client = await db.platform.connect();
    try {
      await client.query('BEGIN');
      for (const [sql, params] of statements) await client.query(sql, params);
      const statementsPassed = true;
      try {
        await client.query('COMMIT');
        return { statementsPassed, code: undefined };
      } catch (error) {
        return { statementsPassed, code: (error as { code?: string }).code };
      }
    } finally {
      client.release();
    }
  }

  describe('the invariant (checked at COMMIT)', () => {
    it('a tenant is created with an INVITED owner who has not accepted yet', async () => {
      const tenant = await seedTenant(db.platform);
      const invitee = await seedMember(db.platform, tenant);
      await db.platform.query(`UPDATE memberships SET status = 'INVITED', joined_at = NULL WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee]);
      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, invitee]);
      });
      // Accepting the invitation passes.
      await db.platform.query(`UPDATE memberships SET status = 'ACTIVE', joined_at = now() WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee]);
    });

    it.each([
      ['the owner membership is deactivated', (t: SeededTenant) => [[`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [t.tenantId, t.userId]]]],
      ['an accepted owner goes back to INVITED', (t: SeededTenant) => [[`UPDATE memberships SET status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [t.tenantId, t.userId]]]],
      ['the admin role of the owner is no longer admin', (t: SeededTenant) => [[`UPDATE roles SET is_admin = false WHERE tenant_id = $1 AND id = $2`, [t.tenantId, t.roleId]]]],
      ['the admin role of the owner is deactivated', (t: SeededTenant) => [[`UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2`, [t.tenantId, t.roleId]]]],
      ['the owner membership is deleted', (t: SeededTenant) => [[`DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2`, [t.tenantId, t.userId]], [`DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`, [t.tenantId, t.userId]]]],
      ['the owner flag is cleared and nobody gets it', (t: SeededTenant) => [[`UPDATE memberships SET is_owner = false WHERE tenant_id = $1 AND user_id = $2`, [t.tenantId, t.userId]]]],
    ])('is refused at COMMIT, not at the statement, when %s', async (_label, build) => {
      const tenant = await ownedTenant();
      const result = await failsAtCommit(build(tenant) as Array<[string, unknown[]]>);
      expect(result).toEqual({ statementsPassed: true, code: SqlState.checkViolation });
    });

    it('is refused when the owner moves to a role that is not admin', async () => {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const result = await failsAtCommit([[`UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId, staff]]]);
      expect(result.code).toBe(SqlState.checkViolation);
    });

    it('a transfer that leaves a new ACTIVE admin owner passes', async () => {
      const tenant = await ownedTenant();
      const successor = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, successor, tenant.roleId]);
      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query('UPDATE memberships SET is_owner = false WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
        await tx.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, successor]);
      });
    });

    it('two owners are refused at once by the unique index', async () => {
      const tenant = await ownedTenant();
      const other = await seedMember(db.platform, tenant);
      expect(await sqlStateOf(() => db.platform.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, other]))).toBe(SqlState.uniqueViolation);
    });

    it('an admin role that is not the owner\'s can be deactivated', async () => {
      const tenant = await ownedTenant();
      const second = await adminRole(tenant);
      await db.platform.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, second]);
    });

    it('tenants without an owner are not affected', async () => {
      const tenant = await seedTenant(db.platform);
      await db.platform.query('UPDATE roles SET is_admin = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, tenant.roleId]);
    });

    it('purge_tenant still works for a tenant with an owner', async () => {
      const tenant = await ownedTenant();
      await db.platform.query('SELECT purge_tenant($1)', [tenant.tenantId]);
      expect((await db.owner.query('SELECT 1 FROM tenants WHERE id = $1', [tenant.tenantId])).rowCount).toBe(0);
    });

    it('is also enforced when the change comes through auth_consume_user_token (no tenant context)', async () => {
      const tenant = await ownedTenant();
      const result = await failsAtCommit([[`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]]]);
      expect(result.code).toBe(SqlState.checkViolation);
    });
  });

  describe('privilege escalation guard (the API role)', () => {
    it('a member without an admin role cannot give themselves one', async () => {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const member = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, member, staff]);
      const attempt = () => asMember(tenant, member, (client) => client.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, member, tenant.roleId]));
      expect(await sqlStateOf(attempt)).toBe(SqlState.insufficientPrivilege);
    });

    it('nor mark a role as admin, create an admin role, or grant manage all', async () => {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const member = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, member, staff]);
      const manageAll = (await db.owner.query<{ id: string }>(`SELECT id FROM permissions WHERE action = 'manage' AND subject = 'all'`)).rows[0]!.id;
      const attempts = [
        () => asMember(tenant, member, (client) => client.query('UPDATE roles SET is_admin = true WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, staff])),
        () => asMember(tenant, member, (client) => client.query(`INSERT INTO roles (tenant_id, name, is_admin) VALUES ($1, 'Sneaky', true)`, [tenant.tenantId])),
        () => asMember(tenant, member, (client) => client.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)', [tenant.tenantId, staff, manageAll])),
      ];
      for (const attempt of attempts) expect(await sqlStateOf(attempt)).toBe(SqlState.insufficientPrivilege);
    });

    it('nor become owner, and a non-owner admin cannot take the ownership away from the owner', async () => {
      const tenant = await ownedTenant();
      const second = await adminRole(tenant);
      const admin = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, admin, second]);
      const clear = () => asMember(tenant, admin, (client) => client.query('UPDATE memberships SET is_owner = false WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]));
      expect(await sqlStateOf(clear)).toBe(SqlState.insufficientPrivilege);
      const take = () => asMember(tenant, admin, (client) => client.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, admin]));
      expect(await sqlStateOf(take)).toBe(SqlState.insufficientPrivilege);
    });

    it('an administrator can give an admin role and create admin roles', async () => {
      const tenant = await ownedTenant();
      const member = await seedMember(db.platform, tenant);
      await asMember(tenant, tenant.userId, async (client) => {
        await client.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, member, tenant.roleId]);
        await client.query(`INSERT INTO roles (tenant_id, name, is_admin) VALUES ($1, 'Another admin', true)`, [tenant.tenantId]);
      });
    });

    it('the owner can transfer the ownership to an admin member, in the right order', async () => {
      const tenant = await ownedTenant();
      const successor = await seedMember(db.platform, tenant);
      await asMember(tenant, tenant.userId, async (client) => {
        await client.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, successor, tenant.roleId]);
        await client.query('UPDATE memberships SET is_owner = false WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
        await client.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, successor]);
      });
      const { rows } = await db.owner.query<{ user_id: string }>('SELECT user_id FROM memberships WHERE tenant_id = $1 AND is_owner', [tenant.tenantId]);
      expect(rows.map((row) => row.user_id)).toEqual([successor]);
    });

    it('a transfer to the member the owner names works, and nobody else can take the ownership afterwards', async () => {
      const tenant = await ownedTenant();
      const bystander = await seedMember(db.platform, tenant);
      const attempt = () =>
        asMember(tenant, tenant.userId, async (client) => {
          await client.query('UPDATE memberships SET is_owner = false WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
          await client.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, bystander, tenant.roleId]);
          // The window was opened for the owner (acting user), who may name the new owner: it is the owner who calls.
          await client.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, bystander]);
        });
      await attempt();
      expect((await db.owner.query<{ user_id: string }>('SELECT user_id FROM memberships WHERE tenant_id = $1 AND is_owner', [tenant.tenantId])).rows[0]!.user_id).toBe(bystander);
      // Another member, with no window opened by them, cannot take it from the new owner.
      const third = await seedMember(db.platform, tenant);
      const steal = () => asMember(tenant, third, (client) => client.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, third]));
      expect(await sqlStateOf(steal)).toBe(SqlState.insufficientPrivilege);
    });

    it('the platform (app_platform) is not restricted: sign-up and purges create admins and owners', async () => {
      const tenant = await seedTenant(db.platform);
      await db.platform.query(`INSERT INTO roles (tenant_id, name, is_admin) VALUES ($1, 'Platform made admin', true)`, [tenant.tenantId]);
    });
  });

  describe('bypass attempts found in the security review', () => {
    /** A plain member (non-admin role) of an owned tenant. */
    async function plainMember() {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const userId = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, userId, staff]);
      return { tenant, userId, staff };
    }

    it('moving memberships.user_id (which cascades) is refused', async () => {
      const { tenant, userId } = await plainMember();
      const other = await seedMember(db.platform, await seedTenant(db.platform));
      const code = await sqlStateOf(() =>
        asMember(tenant, userId, (tx) => tx.query('UPDATE memberships SET user_id = $2 WHERE tenant_id = $1 AND is_owner', [tenant.tenantId, other])),
      );
      expect(code).toBe('23001');
    });

    it('moving a manage all grant to another role (role_permissions.role_id) is refused', async () => {
      const { tenant, userId, staff } = await plainMember();
      const adminId = await adminRole(tenant, 'Holder');
      await db.platform.query(
        `INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE action = 'manage' AND subject = 'all'`,
        [tenant.tenantId, adminId],
      );
      const code = await sqlStateOf(() =>
        asMember(tenant, userId, (tx) => tx.query('UPDATE role_permissions SET role_id = $2 WHERE tenant_id = $1 AND role_id = $3', [tenant.tenantId, staff, adminId])),
      );
      expect(code).toBe(SqlState.insufficientPrivilege);
    });

    it('a non-admin cannot reactivate an inactive admin role or an inactive member of one', async () => {
      const { tenant, userId } = await plainMember();
      const inactive = await adminRole(tenant, 'Dormant');
      await db.platform.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, inactive]);
      expect(await sqlStateOf(() => asMember(tenant, userId, (tx) => tx.query('UPDATE roles SET is_active = true WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, inactive])))).toBe(SqlState.insufficientPrivilege);

      const sleeper = await seedMember(db.platform, tenant);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, sleeper]);
      expect(await sqlStateOf(() => asMember(tenant, userId, (tx) => tx.query(`UPDATE memberships SET status = 'ACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, sleeper])))).toBe(SqlState.insufficientPrivilege);
      // The owner can.
      await asMember(tenant, tenant.userId, (tx) => tx.query(`UPDATE memberships SET status = 'ACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, sleeper]));
    });

    it('an accepted owner cannot be sent back to INVITED by clearing joined_at', async () => {
      const tenant = await ownedTenant();
      const code = await sqlStateOf(() =>
        asMember(tenant, tenant.userId, (tx) => tx.query(`UPDATE memberships SET status = 'INVITED', joined_at = NULL WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId])),
      );
      expect(code).toBe(SqlState.checkViolation);
    });

    it('permissions_version cannot be set by a member, only by the bump trigger', async () => {
      const { tenant, userId, staff } = await plainMember();
      expect(await sqlStateOf(() => asMember(tenant, userId, (tx) => tx.query('UPDATE roles SET permissions_version = 2147483647 WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, staff])))).toBe(SqlState.insufficientPrivilege);
      const { rows: before } = await db.platform.query('SELECT permissions_version FROM roles WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, staff]);
      await db.platform.query(`INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE action = 'read' AND subject = 'Company'`, [tenant.tenantId, staff]);
      const { rows: after } = await db.platform.query('SELECT permissions_version FROM roles WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, staff]);
      expect(after[0].permissions_version).toBe(before[0].permissions_version + 1);
    });
  });

  describe('full access through manage all, and revived invitations', () => {
    async function setup() {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const plain = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, plain, staff]);
      return { tenant, plain, staff };
    }
    const grantManageAll = (tenantId: string, roleId: string) =>
      db.platform.query(`INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE action = 'manage' AND subject = 'all'`, [tenantId, roleId]);

    it('a non-admin cannot move themselves to a non-admin role that holds manage all', async () => {
      const { tenant, plain } = await setup();
      const powerful = await nonAdminRole(tenant, 'Powerful');
      await grantManageAll(tenant.tenantId, powerful);
      const code = await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, plain, powerful])));
      expect(code).toBe(SqlState.insufficientPrivilege);
      await asMember(tenant, tenant.userId, (tx) => tx.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, plain, powerful]));
    });

    it('a non-admin cannot reactivate a deactivated role that holds manage all', async () => {
      const { tenant, plain } = await setup();
      const dormant = await nonAdminRole(tenant, 'Dormant');
      await grantManageAll(tenant.tenantId, dormant);
      await db.platform.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, dormant]);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('UPDATE roles SET is_active = true WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, dormant])))).toBe(SqlState.insufficientPrivilege);
    });

    it('a non-admin cannot revive a deactivated invitation to an admin role (INACTIVE to INVITED)', async () => {
      const { tenant, plain } = await setup();
      const invitee = await seedMember(db.platform, tenant);
      await db.platform.query(`UPDATE memberships SET status = 'INVITED', joined_at = NULL WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee]);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee]);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query(`UPDATE memberships SET status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee])))).toBe(SqlState.insufficientPrivilege);
      await asMember(tenant, tenant.userId, (tx) => tx.query(`UPDATE memberships SET status = 'INVITED' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, invitee]));
    });
  });

  describe('lowering an administrator needs full access too', () => {
    async function world() {
      const tenant = await ownedTenant();
      const staff = await nonAdminRole(tenant);
      const plain = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, plain, staff]);
      const otherAdmin = await seedMember(db.platform, tenant);
      return { tenant, plain, staff, otherAdmin };
    }

    it('a non-admin cannot deactivate an administrator or take them off the admin role (42501); an administrator can', async () => {
      const { tenant, plain, staff, otherAdmin } = await world();
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, otherAdmin])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, otherAdmin, staff])))).toBe(SqlState.insufficientPrivilege);
      await asMember(tenant, tenant.userId, (tx) => tx.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, otherAdmin]));
    });

    it('a non-admin cannot clear the admin flag of a role, deactivate it, or remove its manage all', async () => {
      const { tenant, plain } = await world();
      const second = await adminRole(tenant, 'Another admin');
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('UPDATE roles SET is_admin = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, second])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, second])))).toBe(SqlState.insufficientPrivilege);

      const powerful = await nonAdminRole(tenant, 'Holder');
      await db.platform.query(`INSERT INTO role_permissions (tenant_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE action = 'manage' AND subject = 'all'`, [tenant.tenantId, powerful]);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant.tenantId, powerful])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asMember(tenant, plain, (tx) => tx.query(`UPDATE role_permissions SET permission_id = (SELECT id FROM permissions WHERE action = 'read' AND subject = 'Company') WHERE tenant_id = $1 AND role_id = $2`, [tenant.tenantId, powerful])))).toBe(SqlState.insufficientPrivilege);
      await asMember(tenant, tenant.userId, (tx) => tx.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant.tenantId, powerful]));
      await asMember(tenant, tenant.userId, (tx) => tx.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, second]));
    });

    it('a non-admin can still change the members and roles that carry no full access', async () => {
      const { tenant, plain, staff } = await world();
      const other = await seedMember(db.platform, tenant);
      await db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, other, staff]);
      await asMember(tenant, plain, (tx) => tx.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, other]));
      await asMember(tenant, plain, (tx) => tx.query('UPDATE roles SET is_active = false WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, staff]));
    });
  });
});
