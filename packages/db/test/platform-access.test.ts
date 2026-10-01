import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('what the platform needs', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const asUser = <T>(userId: string, work: Parameters<typeof withContext<T>>[2]) => withContext(db.runtime, { userId }, work);
  const platformAdmin = async () => {
    const userId = await seedMember(db.platform, tenant);
    await db.platform.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [userId]);
    return userId;
  };
  const session = async (userId: string, options: { tenantId?: string | null; expires?: string; revoked?: boolean } = {}) =>
    (await db.platform.query<{ id: string }>(
      `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, $3, now() + $4::interval, ${options.revoked ? 'now()' : 'NULL'}) RETURNING id`,
      [userId, options.tenantId ?? null, hash(), options.expires ?? '15 minutes'],
    )).rows[0]!.id;
  const access = (asUserId: string, userId: string, sessionId: string) =>
    asUser(asUserId, async (client) => (await client.query<{ ok: boolean }>('SELECT auth_platform_access($1, $2) AS ok', [userId, sessionId])).rows[0]!.ok);

  describe('the invitation e-mail', () => {
    it('is a whitelisted platform event type that the platform login (not the API) can enqueue', async () => {
      const call = (pool: TestDatabase['platform'] | TestDatabase['runtime']) =>
        pool.query(`SELECT enqueue_platform_event('email.invitation', '{"userId":"u","token":"t"}'::jsonb)`);
      await call(db.platform);
      await call(db.runtime); // the API role may also enqueue (the password reset does)
      expect(await sqlStateOf(() => db.platform.query(`SELECT enqueue_platform_event('email.unknown', '{}'::jsonb)`))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('tenants cannot change their own status or plan', () => {
    it.each(['status', 'plan_id', 'extra_storage_bytes', 'db_cluster', 'slug', 'country_code'])('the API role cannot update %s', async (column) => {
      const value: Record<string, string> = {
        status: `'SUSPENDED'`,
        plan_id: `(SELECT id FROM plans WHERE code = 'starter' LIMIT 1)`,
        extra_storage_bytes: '999',
        db_cluster: `'other'`,
        slug: `'hijacked'`,
        country_code: `'MX'`,
      };
      const attempt = () => withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
        client.query(`UPDATE tenants SET ${column} = ${value[column]} WHERE id = $1`, [tenant.tenantId]));
      expect(await sqlStateOf(attempt)).toBe(SqlState.insufficientPrivilege);
    });

    it('but it can edit the name and branding of its own tenant', async () => {
      await withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
        client.query(`UPDATE tenants SET name = 'Renamed', primary_color = '#112233' WHERE id = $1`, [tenant.tenantId]));
      const { rows } = await db.owner.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenant.tenantId]);
      expect(rows[0]!.name).toBe('Renamed');
    });

    it('the platform login can suspend and reactivate', async () => {
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenant.tenantId]);
      await db.platform.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [tenant.tenantId]);
    });
  });

  describe('auth_is_platform_admin', () => {
    it('is true for an active platform admin asking about themselves', async () => {
      const admin = await platformAdmin();
      expect(await asUser(admin, async (c) => (await c.query<{ ok: boolean }>('SELECT auth_is_platform_admin($1) AS ok', [admin])).rows[0]!.ok)).toBe(true);
    });

    it('is false for a normal user, and for asking about someone else', async () => {
      const [admin, normal] = [await platformAdmin(), await seedMember(db.platform, tenant)];
      expect(await asUser(normal, async (c) => (await c.query<{ ok: boolean }>('SELECT auth_is_platform_admin($1) AS ok', [normal])).rows[0]!.ok)).toBe(false);
      expect(await asUser(normal, async (c) => (await c.query<{ ok: boolean }>('SELECT auth_is_platform_admin($1) AS ok', [admin])).rows[0]!.ok)).toBe(false);
    });

    it('is false for a disabled admin', async () => {
      const admin = await platformAdmin();
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [admin]);
      expect(await asUser(admin, async (c) => (await c.query<{ ok: boolean }>('SELECT auth_is_platform_admin($1) AS ok', [admin])).rows[0]!.ok)).toBe(false);
    });

    it('the API role cannot read platform_admins directly', async () => {
      expect(await sqlStateOf(() => db.runtime.query('SELECT * FROM platform_admins'))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('auth_platform_access (checked on every platform request)', () => {
    it('is true for an active admin with a live platform session', async () => {
      const admin = await platformAdmin();
      expect(await access(admin, admin, await session(admin))).toBe(true);
    });

    it.each([
      ['a revoked session', async (admin: string) => session(admin, { revoked: true })],
      ['an expired session', async (admin: string) => session(admin, { expires: '-1 second' })],
      ['a tenant session (it has an active tenant)', async (admin: string) => session(admin, { tenantId: tenant.tenantId })],
    ])('is false for %s', async (_label, make) => {
      const admin = await platformAdmin();
      expect(await access(admin, admin, await make(admin))).toBe(false);
    });

    it('is false once the admin row is removed, the account disabled, or the session belongs to someone else', async () => {
      const [removed, disabled, owner, thief] = [await platformAdmin(), await platformAdmin(), await platformAdmin(), await platformAdmin()];
      const [removedSession, disabledSession, ownerSession] = [await session(removed), await session(disabled), await session(owner)];
      await db.platform.query('DELETE FROM platform_admins WHERE user_id = $1', [removed]);
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled]);
      expect(await access(removed, removed, removedSession)).toBe(false);
      expect(await access(disabled, disabled, disabledSession)).toBe(false);
      expect(await access(thief, thief, ownerSession)).toBe(false);
    });

    it('cannot be asked on behalf of another user', async () => {
      const [admin, other] = [await platformAdmin(), await platformAdmin()];
      expect(await access(other, admin, await session(admin))).toBe(false);
    });

    it('a password reset (which revokes the sessions) ends the platform session', async () => {
      const admin = await platformAdmin();
      const id = await session(admin);
      await db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE user_id = $1', [admin]);
      expect(await access(admin, admin, id)).toBe(false);
    });
  });

  describe('platform_audit_logs', () => {
    it('is written by the platform login and is append-only', async () => {
      const { rows } = await db.platform.query<{ id: string }>(
        `INSERT INTO platform_audit_logs (actor_user_id, action, target_tenant_id, data) VALUES ($1, 'tenant.created', $2, '{"slug":"x"}') RETURNING id`,
        [tenant.userId, tenant.tenantId],
      );
      const id = rows[0]!.id;
      expect(await sqlStateOf(() => db.platform.query('UPDATE platform_audit_logs SET action = $1 WHERE id = $2', ['changed', id]))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => db.platform.query('DELETE FROM platform_audit_logs WHERE id = $1', [id]))).toBe(SqlState.insufficientPrivilege);
    });

    it.each(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])('the API and worker roles have no %s on it', async (privilege) => {
      const { rows } = await db.owner.query<{ role: string }>(
        `SELECT r FROM unnest(ARRAY['app_runtime', 'app_worker']) AS r WHERE has_table_privilege(r, 'platform_audit_logs', $1)`,
        [privilege],
      );
      expect(rows).toEqual([]);
    });

    it('app_platform can neither update, delete nor truncate it', async () => {
      const { rows } = await db.owner.query<{ privilege: string }>(
        `SELECT p AS privilege FROM unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) AS p WHERE has_table_privilege('app_platform', 'platform_audit_logs', p)`,
      );
      expect(rows).toEqual([]);
    });

    it('survives the purge of the tenant it talks about (no foreign keys)', async () => {
      const doomed = await seedTenant(db.platform);
      await db.platform.query(`INSERT INTO platform_audit_logs (actor_user_id, action, target_tenant_id) VALUES ($1, 'tenant.created', $2)`, [tenant.userId, doomed.tenantId]);
      await db.platform.query('SELECT purge_tenant($1)', [doomed.tenantId]);
      expect((await db.owner.query('SELECT 1 FROM platform_audit_logs WHERE target_tenant_id = $1', [doomed.tenantId])).rowCount).toBe(1);
    });
  });
});
