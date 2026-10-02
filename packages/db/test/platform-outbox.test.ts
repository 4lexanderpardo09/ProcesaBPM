import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

const PLATFORM_TABLES = ['platform_outbox_events', 'platform_event_types'];
const WORKER_FUNCTIONS = [
  'claim_outbox_events(10, NULL::text[])',
  'claim_platform_outbox_events(10)',
  `complete_platform_outbox_event('${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}', 1)`,
  `fail_platform_outbox_event('${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}', 1, 'x', NULL, 10)`,
];

describe('platform outbox and the worker role', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const enqueue = (payload: object = { userId: 'u', token: 'secret-token' }, type = 'email.password_reset') =>
    withoutContext(db.runtime, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT enqueue_platform_event($1, $2::jsonb) AS id', [
        type,
        JSON.stringify(payload),
      ]);
      return rows[0]!.id;
    });
  const claim = (limit = 100, lease = '5 minutes', maxAttempts = 10) =>
    withoutContext(db.worker, async (client) => {
      const { rows } = await client.query<{ id: string; attempts: number; status: string; payload: Record<string, unknown> }>(
        'SELECT * FROM claim_platform_outbox_events($1, $2::interval, $3)',
        [limit, lease, maxAttempts],
      );
      return rows;
    });
  const eventRow = async (id: string) =>
    (await db.owner.query<{ status: string; attempts: number; payload: Record<string, unknown>; processed_at: Date | null; last_error: string | null; available_at: Date }>(
      'SELECT status, attempts, payload, processed_at, last_error, available_at FROM platform_outbox_events WHERE id = $1',
      [id],
    )).rows[0]!;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  describe('app_runtime (the API)', () => {
    it.each([
      ['platform_outbox_events', `INSERT INTO platform_outbox_events (type, payload) VALUES ('email.password_reset', '{}')`, `UPDATE platform_outbox_events SET attempts = 0`],
      ['platform_event_types', `INSERT INTO platform_event_types (type, description) VALUES ('x', 'y')`, `UPDATE platform_event_types SET description = 'z'`],
    ])('cannot read or write %s directly', async (table, insert, update) => {
      for (const statement of [`SELECT * FROM ${table}`, insert, update, `DELETE FROM ${table}`]) {
        expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(statement)))).toBe(SqlState.insufficientPrivilege);
      }
    });

    it.each([...WORKER_FUNCTIONS, `purge_processed_platform_outbox_events('1 day')`])('cannot call %s', async (call) => {
      expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(`SELECT * FROM ${call}`)))).toBe(
        SqlState.insufficientPrivilege,
      );
    });

    it('can enqueue without any tenant or user context', async () => {
      const id = await enqueue();
      expect(await eventRow(id)).toMatchObject({ status: 'PENDING', attempts: 0, payload: { userId: 'u', token: 'secret-token' } });
    });

    it('is refused an event type outside the whitelist', async () => {
      expect(await sqlStateOf(() => enqueue({}, 'email.anything_else'))).toBe(SqlState.insufficientPrivilege);
    });

    it.each([
      ['a payload that is not an object', '[1,2]'],
      ['a payload larger than 8 KiB', JSON.stringify({ blob: 'x'.repeat(9000) })],
    ])('is refused %s', async (_label, payload) => {
      const call = () =>
        withoutContext(db.runtime, (client) => client.query(`SELECT enqueue_platform_event('email.password_reset', $1::jsonb)`, [payload]));
      expect(await sqlStateOf(call)).toBe(SqlState.checkViolation);
    });

    it('cannot claim or read the tenant outbox either', async () => {
      const call = () => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) => client.query('SELECT * FROM claim_outbox_events(10, NULL::text[])'));
      expect(await sqlStateOf(call)).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('app_worker', () => {
    it('is not BYPASSRLS and has no direct access to the platform tables', async () => {
      const { rows } = await db.worker.query<{ rolbypassrls: boolean; rolname: string }>(
        `SELECT rolbypassrls, rolname FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toMatchObject({ rolbypassrls: false });
      const { rows: role } = await db.worker.query<{ current_user: string }>('SELECT current_user');
      expect(role[0]!.current_user).toBe('app_worker');
      for (const table of PLATFORM_TABLES) {
        expect(await sqlStateOf(() => db.worker.query(`SELECT * FROM ${table}`))).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('claims platform events and gets the payload', async () => {
      const id = await enqueue({ userId: 'claimed', token: 't-1' });
      const claimed = (await claim()).find((row) => row.id === id)!;
      expect(claimed).toMatchObject({ status: 'PROCESSING', attempts: 1, payload: { userId: 'claimed', token: 't-1' } });
    });

    it('claims tenant outbox events of every tenant, but only sees a tenant with its context', async () => {
      await db.platform.query(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'test.a', '{}'), ($2, 'test.b', '{}')`, [
        tenantA.tenantId,
        tenantB.tenantId,
      ]);
      const claimed = await withoutContext(db.worker, async (client) => (await client.query<{ tenant_id: string; type: string; id: string; attempts: number }>('SELECT * FROM claim_outbox_events(100, NULL::text[])')).rows);
      expect(claimed.filter((row) => row.type.startsWith('test.')).map((row) => row.tenant_id).sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());

      const withoutTenant = await withoutContext(db.worker, (client) => client.query('SELECT 1 FROM outbox_events'));
      expect(withoutTenant.rowCount).toBe(0);
      const claimedA = claimed.find((row) => row.type === 'test.a')!;
      const claimedB = claimed.find((row) => row.type === 'test.b')!;
      const complete = (tenantId: string, row: { id: string; attempts?: number }) =>
        withContext(db.worker, { tenantId }, async (client) =>
          (await client.query<{ ok: boolean }>('SELECT complete_outbox_event($1, $2) AS ok', [row.id, row.attempts])).rows[0]!.ok,
        );
      expect(await complete(tenantA.tenantId, claimedA as never)).toBe(true);
      // Another tenant's context cannot close it, and neither can a stale attempt.
      expect(await complete(tenantA.tenantId, claimedB as never)).toBe(false);
    });

    it('two workers claiming at the same time get disjoint events', async () => {
      const ids = await Promise.all(Array.from({ length: 20 }, () => enqueue({ userId: 'race' })));
      const [first, second] = await Promise.all([claim(10), claim(10)]);
      const claimedIds = [...first, ...second].map((row) => row.id).filter((id) => ids.includes(id));
      expect(new Set(claimedIds).size).toBe(claimedIds.length);
      expect(claimedIds).toHaveLength(20);
    });
  });

  describe('leases and retries', () => {
    it('does not hand out an event that is leased, and hands it out again once the lease ends', async () => {
      const id = await enqueue();
      await claim(1000);
      expect((await claim(1000)).map((row) => row.id)).not.toContain(id);
      await db.owner.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
      const again = (await claim(1000)).find((row) => row.id === id)!;
      expect(again.attempts).toBe(2);
    });

    it('marks an event FAILED when its lease expires after the maximum number of attempts', async () => {
      const id = await enqueue({ userId: 'u', token: 'to-be-wiped' });
      await claim(1000, '5 minutes', 1);
      await db.owner.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
      expect((await claim(1000, '5 minutes', 1)).map((row) => row.id)).not.toContain(id);
      const failed = await eventRow(id);
      expect(failed).toMatchObject({ status: 'FAILED', last_error: expect.stringContaining('maximum') });
      expect(failed.payload).not.toHaveProperty('token');
    });

    it('a retry requested on the last allowed attempt ends the event in FAILED (it could never be claimed again), without the token', async () => {
      const id = await enqueue({ userId: 'u', token: 'last-attempt-secret' });
      const { attempts } = (await claim(1000, '5 minutes', 1)).find((row) => row.id === id)!;
      const retryAt = new Date(Date.now() + 60_000).toISOString();
      const { rows } = await db.worker.query<{ ok: boolean }>('SELECT fail_platform_outbox_event($1, $2, $3, $4, $5) AS ok', [id, attempts, 'smtp down', retryAt, 1]);
      expect(rows[0]!.ok).toBe(true);
      const failed = await eventRow(id);
      expect(failed.status).toBe('FAILED');
      expect(failed.payload).not.toHaveProperty('token');
    });

    it('a retry before the last attempt keeps the token for the next try', async () => {
      const id = await enqueue({ userId: 'u', token: 'keep-me' });
      const { attempts } = (await claim(1000)).find((row) => row.id === id)!;
      await db.worker.query('SELECT fail_platform_outbox_event($1, $2, $3, $4, $5)', [id, attempts, 'smtp down', new Date(Date.now() + 60_000).toISOString(), 10]);
      expect(await eventRow(id)).toMatchObject({ status: 'PENDING', payload: { token: 'keep-me' } });
    });

    it('complete marks the event DONE and removes the token from the payload', async () => {
      const id = await enqueue({ userId: 'u', token: 'secret' });
      const { attempts } = (await claim(1000)).find((row) => row.id === id)!;
      const { rows } = await db.worker.query<{ ok: boolean }>('SELECT complete_platform_outbox_event($1, $2) AS ok', [id, attempts]);
      expect(rows[0]!.ok).toBe(true);
      expect(await eventRow(id)).toMatchObject({ status: 'DONE', payload: { userId: 'u' }, processed_at: expect.any(Date) });
      expect((await eventRow(id)).payload).not.toHaveProperty('token');
    });

    it('fail schedules a retry (PENDING at the given time) or ends in FAILED without the token', async () => {
      const retried = await enqueue();
      const finished = await enqueue({ userId: 'u', token: 'secret' });
      const claimed = await claim(1000);
      const attemptOf = (id: string) => claimed.find((row) => row.id === id)!.attempts;
      const retryAt = new Date(Date.now() + 60_000).toISOString();
      await db.worker.query('SELECT fail_platform_outbox_event($1, $2, $3, $4)', [retried, attemptOf(retried), 'smtp down', retryAt]);
      await db.worker.query('SELECT fail_platform_outbox_event($1, $2, $3, NULL)', [finished, attemptOf(finished), 'x'.repeat(5000)]);

      expect(await eventRow(retried)).toMatchObject({ status: 'PENDING', last_error: 'smtp down' });
      expect((await eventRow(retried)).available_at.getTime()).toBeGreaterThan(Date.now());
      const failed = await eventRow(finished);
      expect(failed.status).toBe('FAILED');
      expect(failed.last_error).toHaveLength(2000);
      expect(failed.payload).not.toHaveProperty('token');
    });

    it('a worker whose lease expired cannot overwrite the result of the new owner (stale attempt)', async () => {
      const id = await enqueue();
      const stale = (await claim(1000)).find((row) => row.id === id)!.attempts;
      await db.owner.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
      await claim(1000);
      const complete = await db.worker.query<{ ok: boolean }>('SELECT complete_platform_outbox_event($1, $2) AS ok', [id, stale]);
      const fail = await db.worker.query<{ ok: boolean }>('SELECT fail_platform_outbox_event($1, $2, $3, NULL) AS ok', [id, stale, 'late']);
      expect([complete.rows[0]!.ok, fail.rows[0]!.ok]).toEqual([false, false]);
      expect(await eventRow(id)).toMatchObject({ status: 'PROCESSING', attempts: 2 });
    });
  });

  describe('retention', () => {
    it('purge deletes old FAILED events too (they have no processing date: the creation date counts)', async () => {
      const [oldFailed, recentFailed] = [await enqueue(), await enqueue()];
      await db.owner.query(`UPDATE platform_outbox_events SET status = 'FAILED', created_at = now() - interval '10 days' WHERE id = $1`, [oldFailed]);
      await db.owner.query(`UPDATE platform_outbox_events SET status = 'FAILED' WHERE id = $1`, [recentFailed]);
      await db.platform.query(`SELECT purge_processed_platform_outbox_events('7 days')`);
      const remaining = await db.owner.query<{ id: string }>('SELECT id FROM platform_outbox_events WHERE id = ANY($1)', [[oldFailed, recentFailed]]);
      expect(remaining.rows.map((row) => row.id)).toEqual([recentFailed]);
    });

    it('purge deletes only old DONE events and only app_platform can run it', async () => {
      const [oldDone, recentDone, pending] = [await enqueue(), await enqueue(), await enqueue()];
      await db.owner.query(`UPDATE platform_outbox_events SET status = 'DONE', processed_at = now() - interval '10 days' WHERE id = $1`, [oldDone]);
      await db.owner.query(`UPDATE platform_outbox_events SET status = 'DONE', processed_at = now() WHERE id = $1`, [recentDone]);

      expect(await sqlStateOf(() => db.worker.query(`SELECT purge_processed_platform_outbox_events('7 days')`))).toBe(SqlState.insufficientPrivilege);
      const { rows } = await db.platform.query<{ count: string }>(`SELECT purge_processed_platform_outbox_events('7 days') AS count`);
      expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(1);

      const remaining = await db.owner.query<{ id: string }>('SELECT id FROM platform_outbox_events WHERE id = ANY($1)', [[oldDone, recentDone, pending]]);
      expect(remaining.rows.map((row) => row.id).sort()).toEqual([recentDone, pending].sort());
    });
  });

  describe('privileges', () => {
    it('app_platform, the BYPASSRLS login of the API, cannot read the outbox or its tokens', async () => {
      await enqueue({ userId: 'u', token: 'must-not-leak' });
      for (const table of PLATFORM_TABLES) {
        expect(await sqlStateOf(() => db.platform.query(`SELECT * FROM ${table}`))).toBe(SqlState.insufficientPrivilege);
      }
      // It owns (and can read) the tenant outbox, so only the platform outbox functions are closed to it.
      for (const call of [`claim_platform_outbox_events(10)`, `complete_platform_outbox_event('00000000-0000-4000-8000-000000000000', 1)`]) {
        expect(await sqlStateOf(() => db.platform.query(`SELECT * FROM ${call}`))).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('a temporary table cannot shadow the whitelist inside enqueue_platform_event', async () => {
      const attack = () =>
        withoutContext(db.runtime, async (client) => {
          await client.query(`CREATE TEMP TABLE platform_event_types (type text, description text)`);
        });
      expect(await sqlStateOf(attack)).toBe(SqlState.insufficientPrivilege);
    });

    it('app_worker has exactly the table and column privileges of app_runtime', async () => {
      const { rows } = await db.owner.query<{ object: string }>(`
        SELECT c.relname || '.' || p.privilege AS object
        FROM pg_class c
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege)
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND has_table_privilege('app_runtime', c.oid, p.privilege) <> has_table_privilege('app_worker', c.oid, p.privilege)
      `);
      expect(rows).toEqual([]);
    });

    it('only the worker (not the API) may claim, complete and fail events', async () => {
      const { rows } = await db.owner.query<{ fn: string; role: string }>(`
        SELECT p.proname AS fn, r.rolname AS role
        FROM pg_proc p CROSS JOIN pg_roles r
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('claim_outbox_events', 'claim_platform_outbox_events', 'complete_platform_outbox_event', 'fail_platform_outbox_event')
          AND r.rolname IN ('app_runtime', 'app_worker')
          AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
        ORDER BY 1, 2
      `);
      expect(rows.every((row) => row.role === 'app_worker')).toBe(true);
      expect(new Set(rows.map((row) => row.fn)).size).toBe(4);
    });
  });
});
