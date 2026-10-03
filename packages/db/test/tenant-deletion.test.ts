import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('tenant deletion and purge', () => {
  let db: TestDatabase;
  let requesterId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    requesterId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Op', 'Erator') RETURNING id`, [`operator-${randomUUID()}@example.com`]);
    await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [requesterId]);
  });
  afterAll(() => db.close());

  /** A tenant whose deletion was requested `daysAgo` days ago (30 days period). */
  async function pending(daysAgo = 31): Promise<SeededTenant> {
    const tenant = await seedTenant(db.platform);
    await db.owner.query(
      `UPDATE tenants SET status = 'PENDING_DELETION', deletion_requested_at = now() - make_interval(days => $2), deletion_requested_by_id = $3,
              purge_after = now() - make_interval(days => $2) + interval '30 days' WHERE id = $1`,
      [tenant.tenantId, daysAgo, requesterId],
    );
    return tenant;
  }
  const claim = (pool = db.worker, limit = 100, lease = '30 minutes') =>
    withoutContext(pool, async (client) => (await client.query<{ out_tenant_id: string; out_attempt: number }>('SELECT * FROM claim_due_tenant_purges($1, $2::interval)', [limit, lease])).rows);
  const mine = (rows: Array<{ out_tenant_id: string; out_attempt: number }>, tenant: SeededTenant) => rows.find((row) => row.out_tenant_id === tenant.tenantId);
  const finish = (tenant: SeededTenant, attempt: number) =>
    withoutContext(db.worker, async (client) => (await client.query<{ ok: boolean }>('SELECT finish_tenant_purge($1, $2) AS ok', [tenant.tenantId, attempt])).rows[0]!.ok);
  const fail = (tenant: SeededTenant, attempt: number, retryAt: Date | null = null) =>
    withoutContext(db.worker, async (client) => (await client.query<{ ok: boolean }>('SELECT fail_tenant_purge($1, $2, $3, $4) AS ok', [tenant.tenantId, attempt, 'S3 unreachable', retryAt?.toISOString() ?? null])).rows[0]!.ok);
  const tenantRow = async (id: string) => (await db.owner.query('SELECT * FROM tenants WHERE id = $1', [id])).rows[0];
  const count = async (table: string, tenantId: string) => (await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId])).rows[0]!.n;

  describe('the states', () => {
    it('PENDING_DELETION needs the date of the purge and who asked; PURGED needs its date', async () => {
      const tenant = await seedTenant(db.platform);
      const set = (sql: string) => db.owner.query(`UPDATE tenants SET ${sql} WHERE id = $1`, [tenant.tenantId]);
      expect(await sqlStateOf(() => set(`status = 'PENDING_DELETION'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`status = 'PENDING_DELETION', purge_after = now() + interval '30 days'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`purge_after = now() + interval '30 days'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`status = 'PURGED'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`status = 'PURGED', purged_at = now()`))).toBe(SqlState.checkViolation);
      await set(`status = 'PENDING_DELETION', purge_after = now() + interval '30 days', deletion_requested_at = now(), deletion_requested_by_id = '${requesterId}'`);
      expect(await sqlStateOf(() => set(`status = 'SUSPENDED'`))).toBe(SqlState.checkViolation);
      await set(`status = 'SUSPENDED', purge_after = NULL, deletion_requested_at = NULL, deletion_requested_by_id = NULL`);
    });

    it('the tenant itself cannot change any of it', async () => {
      const tenant = await seedTenant(db.platform);
      for (const column of ['status', 'purge_after', 'deletion_requested_at', 'purged_at', 'purge_attempts', 'purge_lease_until']) {
        const value = column === 'status' ? `'SUSPENDED'` : column === 'purge_attempts' ? '5' : 'now()';
        expect(await sqlStateOf(() => db.runtime.query(`UPDATE tenants SET ${column} = ${value} WHERE id = $1`, [tenant.tenantId])), column).not.toBeUndefined();
      }
    });
  });

  describe('claiming due purges', () => {
    it('does nothing before the period is over', async () => {
      const tenant = await pending(10);
      expect(mine(await claim(), tenant)).toBeUndefined();
    });

    it('claims a due tenant once; a live lease keeps others away; an expired one is claimed again with the next attempt', async () => {
      const tenant = await pending();
      const first = mine(await claim(), tenant);
      expect(first).toEqual({ out_tenant_id: tenant.tenantId, out_attempt: 1 });
      expect(mine(await claim(), tenant)).toBeUndefined();
      await db.owner.query(`UPDATE tenants SET purge_lease_until = now() - interval '1 second' WHERE id = $1`, [tenant.tenantId]);
      expect(mine(await claim(), tenant)).toEqual({ out_tenant_id: tenant.tenantId, out_attempt: 2 });
    });

    it('two workers at once never claim the same tenant', async () => {
      const tenants = await Promise.all([pending(), pending(), pending()]);
      const results = await Promise.all(Array.from({ length: 6 }, () => claim()));
      for (const tenant of tenants) expect(results.filter((rows) => mine(rows, tenant) !== undefined)).toHaveLength(1);
    });

    it('respects the limit and waits out a retry time', async () => {
      const [a, b] = [await pending(), await pending()];
      await db.owner.query(`UPDATE tenants SET purge_retry_at = now() + interval '1 hour' WHERE id = $1`, [a.tenantId]);
      const rows = await claim(db.worker, 1);
      expect(rows.length).toBeLessThanOrEqual(1);
      expect(mine(rows, a)).toBeUndefined();
      expect(mine(await claim(), a)).toBeUndefined();
      void b;
    });

    it('is not available to the API login', async () => {
      expect(await sqlStateOf(() => claim(db.runtime))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('failing a step', () => {
    it('releases the lease, remembers the error and waits for the retry time', async () => {
      const tenant = await pending();
      const { out_attempt: attempt } = mine(await claim(), tenant)!;
      expect(await fail(tenant, attempt, new Date(Date.now() + 3_600_000))).toBe(true);
      expect(await tenantRow(tenant.tenantId)).toMatchObject({ purge_lease_until: null, purge_last_error: 'S3 unreachable', status: 'PENDING_DELETION' });
      expect(mine(await claim(), tenant)).toBeUndefined();
      await db.owner.query(`UPDATE tenants SET purge_retry_at = now() - interval '1 second' WHERE id = $1`, [tenant.tenantId]);
      expect(mine(await claim(), tenant)).toEqual({ out_tenant_id: tenant.tenantId, out_attempt: 2 });
    });

    it('a stale attempt cannot fail what the new owner is doing', async () => {
      const tenant = await pending();
      const { out_attempt: stale } = mine(await claim(), tenant)!;
      await db.owner.query(`UPDATE tenants SET purge_lease_until = now() - interval '1 second' WHERE id = $1`, [tenant.tenantId]);
      await claim();
      expect(await fail(tenant, stale)).toBe(false);
      expect((await tenantRow(tenant.tenantId)).purge_lease_until).not.toBeNull();
    });
  });

  describe('finishing: data gone, tombstone left', () => {
    it('removes the data of the tenant, keeps a PURGED row with its identity and audits it', async () => {
      const tenant = await pending();
      const member = await seedMember(db.platform, tenant);
      const other = await seedTenant(db.platform);
      expect(await count('companies', tenant.tenantId)).toBeGreaterThan(0);
      const before = await tenantRow(tenant.tenantId);

      const { out_attempt: attempt } = mine(await claim(), tenant)!;
      expect(await finish(tenant, attempt)).toBe(true);

      const row = await tenantRow(tenant.tenantId);
      expect(row).toMatchObject({ status: 'PURGED', slug: before.slug, name: before.name, plan_id: before.plan_id, purge_after: null, deletion_requested_by_id: requesterId });
      expect(row.purged_at).not.toBeNull();
      for (const table of ['companies', 'memberships', 'roles', 'audit_logs', 'tenant_usage']) expect(await count(table, tenant.tenantId), table).toBe(0);
      // Their members, who belonged to nothing else, are gone too; the operator (a platform admin) is not.
      expect((await db.owner.query('SELECT 1 FROM users WHERE id = ANY($1::uuid[])', [[tenant.userId, member]])).rowCount).toBe(0);
      expect((await db.owner.query('SELECT 1 FROM users WHERE id = $1', [requesterId])).rowCount).toBe(1);
      const log = await db.owner.query(`SELECT actor_user_id, data FROM platform_audit_logs WHERE action = 'tenant.purged' AND target_tenant_id = $1`, [tenant.tenantId]);
      expect(log.rows).toEqual([{ actor_user_id: requesterId, data: expect.objectContaining({ slug: before.slug }) }]);
      // Another tenant is untouched.
      expect(await count('companies', other.tenantId)).toBeGreaterThan(0);
      expect((await tenantRow(other.tenantId)).status).toBe('ACTIVE');
    });

    it('is never processed again: PURGED is not claimed and a second finish does nothing', async () => {
      const tenant = await pending();
      const { out_attempt: attempt } = mine(await claim(), tenant)!;
      expect(await finish(tenant, attempt)).toBe(true);
      expect(await finish(tenant, attempt)).toBe(false);
      await db.owner.query(`UPDATE tenants SET purge_lease_until = NULL WHERE id = $1`, [tenant.tenantId]);
      expect(mine(await claim(), tenant)).toBeUndefined();
    });

    it('needs the current attempt and a due tenant', async () => {
      const tenant = await pending();
      const { out_attempt: stale } = mine(await claim(), tenant)!;
      await db.owner.query(`UPDATE tenants SET purge_lease_until = now() - interval '1 second' WHERE id = $1`, [tenant.tenantId]);
      const { out_attempt: current } = mine(await claim(), tenant)!;
      expect(await finish(tenant, stale)).toBe(false);
      expect((await tenantRow(tenant.tenantId)).status).toBe('PENDING_DELETION');

      const notDue = await pending(10);
      expect(await finish(notDue, 0)).toBe(false);
      expect(await finish(tenant, current)).toBe(true);
    });

    it('is not available to the API login', async () => {
      const tenant = await pending();
      expect(await sqlStateOf(() => withoutContext(db.runtime, (c) => c.query('SELECT finish_tenant_purge($1, 1)', [tenant.tenantId])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => withoutContext(db.runtime, (c) => c.query(`SELECT fail_tenant_purge($1, 1, 'x', NULL)`, [tenant.tenantId])))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('the notice for the owner', () => {
    const notice = (tenantId: string, userId: string) =>
      withoutContext(db.worker, async (client) => (await client.query('SELECT * FROM worker_tenant_deletion_notice($1, $2)', [tenantId, userId])).rows);

    it('gives the address, name and date only for the active owner of a tenant pending deletion', async () => {
      const tenant = await pending(1);
      await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      const rows = await notice(tenant.tenantId, tenant.userId);
      expect(rows).toEqual([expect.objectContaining({ out_email: expect.stringContaining('@'), out_tenant_name: expect.any(String), out_purge_after: expect.any(Date) })]);
      const member = await seedMember(db.platform, tenant);
      expect(await notice(tenant.tenantId, member)).toEqual([]);
      const active = await seedTenant(db.platform);
      await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [active.tenantId, active.userId]);
      expect(await notice(active.tenantId, active.userId)).toEqual([]);
    });
  });

});
