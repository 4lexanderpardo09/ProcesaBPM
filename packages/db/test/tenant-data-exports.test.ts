import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claim {
  out_tenant_id: string;
  out_export_id: string;
  out_include_files: boolean;
  out_claim_token: string;
  out_attempt: number;
}

const SHA = 'a'.repeat(64);

describe('tenant data exports', () => {
  let db: TestDatabase;
  let operatorId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    operatorId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Op', 'Erator') RETURNING id`, [`operator-${randomUUID()}@example.com`]);
  });
  afterAll(() => db.close());

  /** A tenant pending deletion whose purge is `hoursLeft` hours away (negative: already due). */
  async function pending(hoursLeft = 24 * 20): Promise<SeededTenant> {
    const tenant = await seedTenant(db.platform);
    await db.owner.query(
      `UPDATE tenants SET status = 'PENDING_DELETION', deletion_requested_at = now() - interval '1 day', deletion_requested_by_id = $2,
              purge_after = now() + make_interval(hours => $3) WHERE id = $1`,
      [tenant.tenantId, operatorId, hoursLeft],
    );
    return tenant;
  }
  const request = (tenant: SeededTenant, userId = tenant.userId, columns = '', values = '') =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId }, async (client) =>
      (await client.query<{ id: string }>(`INSERT INTO tenant_data_exports (tenant_id, requested_by_id, include_files${columns}) VALUES ($1, $2, true${values}) RETURNING id`, [tenant.tenantId, userId])).rows[0]!.id,
    );
  const worker = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => withoutContext(db.worker, async (client) => (await client.query<T>(sql, params)).rows);
  const claim = (limit = 10, lease = '30 minutes') => worker<Claim>('SELECT * FROM claim_due_tenant_exports($1, $2::interval)', [limit, lease]);
  const claimOf = async (exportId: string) => (await claim()).find((row) => row.out_export_id === exportId);
  const renew = (c: Claim, lease = '30 minutes') => worker<{ ok: boolean }>('SELECT renew_tenant_export_lease($1, $2, $3, $4::interval) AS ok', [c.out_tenant_id, c.out_export_id, c.out_claim_token, lease]).then((r) => r[0]!.ok);
  const finish = (c: Claim, counts: object = { tickets: 3 }) =>
    worker<{ ok: boolean }>('SELECT finish_tenant_export($1, $2, $3, $4, $5, $6::jsonb) AS ok', [c.out_tenant_id, c.out_export_id, c.out_claim_token, 1234, SHA, JSON.stringify(counts)]).then((r) => r[0]!.ok);
  const fail = (c: Claim, code = 'STORAGE_FAILED', retryAt: Date | null = new Date(Date.now() - 1000)) =>
    worker<{ ok: boolean }>('SELECT fail_tenant_export($1, $2, $3, $4, $5) AS ok', [c.out_tenant_id, c.out_export_id, c.out_claim_token, code, retryAt?.toISOString() ?? null]).then((r) => r[0]!.ok);
  const row = async (tenant: SeededTenant, id: string) => (await db.owner.query('SELECT * FROM tenant_data_exports WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, id])).rows[0];
  const expireLease = (id: string) => db.owner.query(`UPDATE tenant_data_exports SET lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
  async function nonAdminMember(tenant: SeededTenant): Promise<string> {
    const roleId = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenant.tenantId, `Agent ${randomUUID().slice(0, 6)}`]);
    return seedMember(db.platform, { tenantId: tenant.tenantId, roleId, companyId: tenant.companyId });
  }
  async function ready(tenant: SeededTenant): Promise<{ id: string; claim: Claim }> {
    const id = await request(tenant);
    const c = (await claimOf(id))!;
    expect(await finish(c)).toBe(true);
    return { id, claim: c };
  }

  describe('requests (what the API may insert)', () => {
    it('lets the owner or an administrator of the tenant in context ask for a fresh PENDING export, dated by the database', async () => {
      const tenant = await pending();
      const id = await request(tenant);
      const created = await row(tenant, id);
      expect(created).toMatchObject({ status: 'PENDING', attempts: 0, claim_token: null, requested_by_id: tenant.userId, include_files: true, download_count: 0 });
      expect(Math.abs(created.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it('refuses a request that is not fresh, or made for someone else, or by a member without full access', async () => {
      const tenant = await pending();
      for (const [columns, values] of [
        [', status', `, 'READY'`],
        [', attempts', ', 1'],
        [', storage_key', `, 'tenants/x/exports/y.zip'`],
        [', download_count', ', 1'],
        [', expires_at', ', now()'],
        [', error_code', `, 'BOOM'`],
      ]) {
        expect(await sqlStateOf(() => request(tenant, tenant.userId, columns, values)), columns).toBe(SqlState.checkViolation);
      }
      const other = await seedMember(db.platform, tenant);
      expect(
        await sqlStateOf(() =>
          withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (c) =>
            c.query('INSERT INTO tenant_data_exports (tenant_id, requested_by_id, include_files) VALUES ($1, $2, true)', [tenant.tenantId, other]),
          ),
        ),
      ).toBe(SqlState.insufficientPrivilege);
      const agent = await nonAdminMember(tenant);
      expect(await sqlStateOf(() => request(tenant, agent))).toBe(SqlState.insufficientPrivilege);
    });

    it('refuses a suspended tenant', async () => {
      const tenant = await seedTenant(db.platform);
      await db.owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [tenant.tenantId]);
      expect(await sqlStateOf(() => request(tenant))).toBe(SqlState.checkViolation);
    });

    it('allows one export in flight per tenant, and another tenant is not affected', async () => {
      const [a, b] = [await pending(), await pending()];
      await request(a);
      expect(await sqlStateOf(() => request(a))).toBe(SqlState.uniqueViolation);
      await request(b);
    });

    it('keeps tenants apart: another tenant neither sees nor writes the rows', async () => {
      const [a, b] = [await pending(), await pending()];
      const id = await request(a);
      const seenByB = await withContext(db.runtime, { tenantId: b.tenantId, userId: b.userId }, async (c) => (await c.query('SELECT id FROM tenant_data_exports WHERE id = $1', [id])).rows);
      expect(seenByB).toEqual([]);
      expect(
        await sqlStateOf(() =>
          withContext(db.runtime, { tenantId: b.tenantId, userId: a.userId }, (c) =>
            c.query('INSERT INTO tenant_data_exports (tenant_id, requested_by_id, include_files) VALUES ($1, $2, true)', [a.tenantId, a.userId]),
          ),
        ),
      ).toBe(SqlState.insufficientPrivilege);
      const counted = await withContext(db.runtime, { tenantId: b.tenantId, userId: b.userId }, (c) =>
        c.query('UPDATE tenant_data_exports SET download_count = download_count + 1 WHERE id = $1', [id]),
      );
      expect(counted.rowCount).toBe(0);
    });

    it('lets the API change nothing but the download counter, one at a time and only for a READY export that has not expired', async () => {
      const tenant = await pending();
      const { id } = await ready(tenant);
      const asApi = (sql: string) => withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (c) => c.query(sql, [id]));
      for (const sql of [
        `UPDATE tenant_data_exports SET status = 'FAILED' WHERE id = $1`,
        `UPDATE tenant_data_exports SET expires_at = now() + interval '1 year' WHERE id = $1`,
        `DELETE FROM tenant_data_exports WHERE id = $1`,
      ]) {
        expect(await sqlStateOf(() => asApi(sql)), sql).toBe(SqlState.insufficientPrivilege);
      }
      expect((await asApi('UPDATE tenant_data_exports SET download_count = download_count + 1, last_downloaded_at = now() WHERE id = $1')).rowCount).toBe(1);
      expect(await sqlStateOf(() => asApi('UPDATE tenant_data_exports SET download_count = download_count + 5 WHERE id = $1'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => asApi('UPDATE tenant_data_exports SET download_count = 0 WHERE id = $1'))).toBe(SqlState.checkViolation);
      await db.owner.query(`UPDATE tenant_data_exports SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
      expect(await sqlStateOf(() => asApi('UPDATE tenant_data_exports SET download_count = download_count + 1 WHERE id = $1'))).toBe(SqlState.checkViolation);
      expect((await row(tenant, id)).download_count).toBe(1);
    });
  });

  describe('the rules on the row', () => {
    it('pins the object under the tenant prefix and keeps codes and checksums well formed', async () => {
      const tenant = await pending();
      const { id } = await ready(tenant);
      const set = (sql: string) => db.owner.query(`UPDATE tenant_data_exports SET ${sql} WHERE id = $1`, [id]);
      expect(await sqlStateOf(() => set(`storage_key = 'tenants/${randomUUID()}/exports/${id}.zip'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`storage_key = 'tenants/${tenant.tenantId}/2026/10/${id}'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`error_code = 'contains data'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`sha256 = 'XYZ'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`counts = '[1]'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`status = 'FAILED'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`status = 'RUNNING'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => set(`storage_deleted_at = now()`))).toBe(SqlState.checkViolation);
      expect((await row(tenant, id)).storage_key).toBe(`tenants/${tenant.tenantId}/exports/${id}.zip`);
    });
  });

  describe('the worker protocol', () => {
    it('claims a due export once with a token; a live lease keeps others away; an expired one is claimed again with a new token', async () => {
      const tenant = await pending();
      const id = await request(tenant);
      const first = (await claimOf(id))!;
      expect(first).toMatchObject({ out_tenant_id: tenant.tenantId, out_include_files: true, out_attempt: 1 });
      expect(await row(tenant, id)).toMatchObject({ status: 'RUNNING', claim_token: first.out_claim_token, attempts: 1 });
      expect(await claimOf(id)).toBeUndefined();
      await expireLease(id);
      const second = (await claimOf(id))!;
      expect(second.out_attempt).toBe(2);
      expect(second.out_claim_token).not.toBe(first.out_claim_token);
      // The first worker woke up: it can neither renew, finish nor fail what the second one owns.
      expect(await renew(first)).toBe(false);
      expect(await finish(first)).toBe(false);
      expect(await fail(first)).toBe(false);
      expect(await renew(second)).toBe(true);
    });

    it('never gives the same export to two workers at once', async () => {
      const ids = await Promise.all([pending(), pending(), pending()].map(async (t) => request(await t)));
      const results = await Promise.all(Array.from({ length: 6 }, () => claim(10)));
      for (const id of ids) expect(results.filter((rows) => rows.some((r) => r.out_export_id === id))).toHaveLength(1);
    });

    it('works for a tenant pending deletion, not once its purge is due, and not for a suspended tenant', async () => {
      const due = await pending(48);
      const dueId = await request(due);
      await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [due.tenantId]);
      expect(await claimOf(dueId)).toBeUndefined();

      const suspended = await seedTenant(db.platform);
      const suspendedId = await request(suspended);
      await db.owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [suspended.tenantId]);
      expect(await claimOf(suspendedId)).toBeUndefined();

      const active = await seedTenant(db.platform);
      expect(await claimOf(await request(active))).toBeDefined();
    });

    it('stops renewing and refuses to finish once the purge is due', async () => {
      const tenant = await pending(48);
      const id = await request(tenant);
      const c = (await claimOf(id))!;
      await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [tenant.tenantId]);
      expect(await renew(c)).toBe(false);
      expect(await finish(c)).toBe(false);
      expect((await row(tenant, id)).status).toBe('RUNNING');
    });

    it('finishes: READY with the object under the tenant prefix, 7 days of validity and the e-mail queued with ids only', async () => {
      const tenant = await pending();
      const { id } = await ready(tenant);
      const built = await row(tenant, id);
      expect(built).toMatchObject({ status: 'READY', claim_token: null, lease_until: null, storage_key: `tenants/${tenant.tenantId}/exports/${id}.zip`, size_bytes: '1234', sha256: SHA, counts: { tickets: 3 } });
      const days = (built.expires_at.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
      const events = await db.owner.query(`SELECT payload FROM platform_outbox_events WHERE type = 'email.data_export_ready' AND payload ->> 'exportId' = $1`, [id]);
      expect(events.rows).toEqual([{ payload: { tenantId: tenant.tenantId, exportId: id, userId: tenant.userId } }]);
    });

    it('never lets the validity outlive the purge', async () => {
      const tenant = await pending(30);
      const { id } = await ready(tenant);
      const { expires_at: expiresAt, purge_after: purgeAfter } = (await db.owner.query(
        `SELECT x.expires_at, t.purge_after FROM tenant_data_exports x JOIN tenants t ON t.id = x.tenant_id WHERE x.id = $1`,
        [id],
      )).rows[0];
      expect(expiresAt.getTime()).toBe(purgeAfter.getTime());
    });

    it('rejects a malformed finish', async () => {
      const tenant = await pending();
      const c = (await claimOf(await request(tenant)))!;
      const call = (size: number, sha: string, counts: string) =>
        worker('SELECT finish_tenant_export($1, $2, $3, $4, $5, $6::jsonb)', [c.out_tenant_id, c.out_export_id, c.out_claim_token, size, sha, counts]);
      expect(await sqlStateOf(() => call(-1, SHA, '{}'))).toBe('22023');
      expect(await sqlStateOf(() => call(1, 'nope', '{}'))).toBe('22023');
      expect(await sqlStateOf(() => call(1, SHA, '[]'))).toBe('22023');
    });

    it('fails with a retry while attempts are left, then for good; the error is a code', async () => {
      const tenant = await pending();
      const id = await request(tenant);
      for (const attempt of [1, 2]) {
        const c = (await claimOf(id))!;
        expect(c.out_attempt).toBe(attempt);
        expect(await fail(c)).toBe(true);
        expect(await row(tenant, id)).toMatchObject({ status: 'PENDING', error_code: 'STORAGE_FAILED', claim_token: null });
      }
      const last = (await claimOf(id))!;
      expect(await fail(last)).toBe(true);
      expect(await row(tenant, id)).toMatchObject({ status: 'FAILED', attempts: 3, error_code: 'STORAGE_FAILED' });
      expect(await claimOf(id)).toBeUndefined();
      // The tenant can ask again once nothing is in flight.
      await request(tenant);
    });

    it('waits out the retry time, fails for good without one, and refuses a code with data in it', async () => {
      const tenant = await pending();
      const id = await request(tenant);
      const c = (await claimOf(id))!;
      expect(await fail(c, 'TEMPORARY', new Date(Date.now() + 3_600_000))).toBe(true);
      expect(await claimOf(id)).toBeUndefined();
      await db.owner.query(`UPDATE tenant_data_exports SET retry_at = now() - interval '1 second' WHERE id = $1`, [id]);
      const again = (await claimOf(id))!;
      expect(await sqlStateOf(() => fail(again, 'tenant name: ACME'))).toBe(SqlState.checkViolation);
      expect(await fail(again, 'EXPORT_TOO_LARGE', null)).toBe(true);
      expect(await row(tenant, id)).toMatchObject({ status: 'FAILED', error_code: 'EXPORT_TOO_LARGE' });
    });

    it('ends as FAILED (LEASE_EXPIRED) when the worker of the last attempt died', async () => {
      const tenant = await pending();
      const id = await request(tenant);
      await claimOf(id);
      await db.owner.query(`UPDATE tenant_data_exports SET attempts = 3, lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
      await claim();
      expect(await row(tenant, id)).toMatchObject({ status: 'FAILED', error_code: 'LEASE_EXPIRED', claim_token: null });
    });

    it('validates the lease', async () => {
      expect(await sqlStateOf(() => claim(1, '10 seconds'))).toBe('22023');
      expect(await sqlStateOf(() => claim(1, '3 hours'))).toBe('22023');
    });
  });

  describe('the ready e-mail', () => {
    const notice = (tenant: SeededTenant, id: string, userId = tenant.userId) => worker('SELECT * FROM worker_data_export_notice($1, $2, $3)', [tenant.tenantId, id, userId]);

    it('gives the address only while the export is ready and the requester is still an active administrator', async () => {
      const tenant = await pending();
      const { id } = await ready(tenant);
      expect(await notice(tenant, id)).toEqual([expect.objectContaining({ out_email: expect.stringContaining('@'), out_tenant_name: expect.any(String), out_expires_at: expect.any(Date) })]);
      expect(await notice(tenant, id, await seedMember(db.platform, tenant))).toEqual([]);
      await db.owner.query(`UPDATE roles SET is_admin = false WHERE id = $1`, [tenant.roleId]);
      expect(await notice(tenant, id)).toEqual([]);
    });

    it('is queued only by the finish: the generic door refuses the type', async () => {
      const tenant = await pending();
      const payload = JSON.stringify({ tenantId: tenant.tenantId, exportId: randomUUID(), userId: tenant.userId });
      for (const pool of [db.runtime, db.worker, db.platform]) {
        expect(await sqlStateOf(() => withContext(pool, { tenantId: tenant.tenantId, userId: tenant.userId }, (c) => c.query(`SELECT enqueue_platform_event('email.data_export_ready', $1::jsonb)`, [payload])))).toBe(SqlState.insufficientPrivilege);
      }
      for (const pool of [db.runtime, db.worker]) {
        expect(await sqlStateOf(() => withoutContext(pool, (c) => c.query(`SELECT enqueue_data_export_ready($1, $2, $3)`, [tenant.tenantId, randomUUID(), tenant.userId])))).toBe(SqlState.insufficientPrivilege);
      }
    });
  });

  describe('expiry (retention step)', () => {
    const expire = (limit = 1000) => worker<{ out_tenant_id: string; out_export_id: string; out_storage_key: string }>('SELECT * FROM retention_expire_tenant_exports($1)', [limit]);
    const markDeleted = (tenant: SeededTenant, id: string) => worker<{ ok: boolean }>('SELECT retention_mark_export_object_deleted($1, $2) AS ok', [tenant.tenantId, id]).then((r) => r[0]!.ok);

    it('expires READY exports past their date and returns their objects until each is marked deleted', async () => {
      const tenant = await pending();
      const { id } = await ready(tenant);
      const fresh = await ready(await pending());
      expect((await expire()).some((r) => r.out_export_id === id)).toBe(false);
      await db.owner.query(`UPDATE tenant_data_exports SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);

      const first = (await expire()).filter((r) => r.out_export_id === id);
      expect(first).toEqual([{ out_tenant_id: tenant.tenantId, out_export_id: id, out_storage_key: `tenants/${tenant.tenantId}/exports/${id}.zip` }]);
      expect((await row(tenant, id)).status).toBe('EXPIRED');
      // The object could not be deleted: it is returned again.
      expect((await expire()).filter((r) => r.out_export_id === id)).toHaveLength(1);
      expect(await markDeleted(tenant, id)).toBe(true);
      expect(await markDeleted(tenant, id)).toBe(false);
      expect((await expire()).some((r) => r.out_export_id === id)).toBe(false);
      expect((await row(tenant, id)).storage_deleted_at).not.toBeNull();
      expect((await db.owner.query('SELECT status FROM tenant_data_exports WHERE id = $1', [fresh.id])).rows[0].status).toBe('READY');
    });

    it('respects the batch limit', async () => {
      for (let i = 0; i < 3; i += 1) {
        const { id } = await ready(await pending());
        await db.owner.query(`UPDATE tenant_data_exports SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
      }
      expect(await expire(2)).toHaveLength(2);
      // Drain what is left, so later runs start clean.
      for (const r of await expire(10_000)) await worker('SELECT retention_mark_export_object_deleted($1, $2)', [r.out_tenant_id, r.out_export_id]);
    });
  });

  describe('the tenant purge', () => {
    const purgeClaims = () => worker<{ out_tenant_id: string; out_attempt: number }>('SELECT * FROM claim_due_tenant_purges(100)');

    it('waits for an export with a live lease, and goes ahead once the lease is over', async () => {
      const tenant = await pending(48);
      const id = await request(tenant);
      await claimOf(id);
      await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [tenant.tenantId]);
      expect((await purgeClaims()).some((r) => r.out_tenant_id === tenant.tenantId)).toBe(false);
      await expireLease(id);
      expect((await purgeClaims()).some((r) => r.out_tenant_id === tenant.tenantId)).toBe(true);
    });

    it('removes the exports with the rest of the data', async () => {
      const tenant = await pending(48);
      await db.owner.query(`UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, tenant.userId]);
      await ready(tenant);
      await request(tenant);
      await db.owner.query(`UPDATE tenants SET purge_after = now() - interval '1 minute' WHERE id = $1`, [tenant.tenantId]);
      const claimed = (await purgeClaims()).find((r) => r.out_tenant_id === tenant.tenantId)!;
      const finished = await worker<{ ok: boolean }>('SELECT finish_tenant_purge($1, $2) AS ok', [tenant.tenantId, claimed.out_attempt]);
      expect(finished).toEqual([{ ok: true }]);
      expect((await db.owner.query('SELECT 1 FROM tenant_data_exports WHERE tenant_id = $1', [tenant.tenantId])).rowCount).toBe(0);
    });
  });

  describe('privileges', () => {
    const WORKER_FUNCTIONS = [
      'claim_due_tenant_exports(integer, interval)',
      'renew_tenant_export_lease(uuid, uuid, uuid, interval)',
      'finish_tenant_export(uuid, uuid, uuid, bigint, text, jsonb)',
      'fail_tenant_export(uuid, uuid, uuid, text, timestamp with time zone)',
      'worker_data_export_notice(uuid, uuid, uuid)',
      'retention_expire_tenant_exports(integer)',
      'retention_mark_export_object_deleted(uuid, uuid)',
    ];

    it('lets only the worker run the protocol, and only the finish queue the e-mail', async () => {
      const { rows } = await db.owner.query<{ fn: string; worker: boolean; runtime: boolean; platform: boolean; owner: string }>(
        `SELECT fn, has_function_privilege('app_worker', fn, 'EXECUTE') AS worker, has_function_privilege('app_runtime', fn, 'EXECUTE') AS runtime,
                has_function_privilege('app_platform', fn, 'EXECUTE') AS platform, pg_get_userbyid(p.proowner) AS owner
         FROM unnest($1::text[]) AS fn JOIN pg_proc p ON p.oid = fn::regprocedure`,
        [WORKER_FUNCTIONS],
      );
      expect(rows).toHaveLength(WORKER_FUNCTIONS.length);
      for (const r of rows) expect(r, r.fn).toMatchObject({ worker: true, runtime: false, platform: false, owner: 'app_platform' });
      const { rows: enqueue } = await db.owner.query(
        `SELECT has_function_privilege('app_platform', 'enqueue_data_export_ready(uuid, uuid, uuid)', 'EXECUTE') AS platform,
                has_function_privilege('app_worker', 'enqueue_data_export_ready(uuid, uuid, uuid)', 'EXECUTE') AS worker,
                has_function_privilege('app_runtime', 'enqueue_data_export_ready(uuid, uuid, uuid)', 'EXECUTE') AS runtime`,
      );
      expect(enqueue).toEqual([{ platform: true, worker: false, runtime: false }]);
    });

    it('refuses the API login at the door', async () => {
      expect(await sqlStateOf(() => withoutContext(db.runtime, (c) => c.query('SELECT * FROM claim_due_tenant_exports(1)')))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => withoutContext(db.runtime, (c) => c.query('SELECT * FROM retention_expire_tenant_exports(1)')))).toBe(SqlState.insufficientPrivilege);
    });
  });
});
