import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, type SeededTenant } from './support/fixtures.js';

/** A timestamp expression relative to the transaction's clock, the same clock the functions read. */
type At = string;

interface RetentionCase {
  readonly fn: string;
  readonly table: string;
  /** The retention window, exactly as the function and its policies spell it. */
  readonly window: string;
  /** Inserts one row whose dated column is `at` and returns its id. */
  readonly insert: (client: pg.PoolClient, at: At) => Promise<string>;
}

const PURGE_FUNCTIONS = [
  'retention_purge_outbox_events',
  'retention_purge_platform_outbox_events',
  'retention_purge_notifications',
  'retention_purge_refresh_sessions',
  'retention_purge_user_tokens',
  'retention_purge_audit_logs',
  'retention_purge_support_sessions',
  'retention_purge_support_access_grants',
  'retention_purge_platform_audit_logs',
] as const;

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('retention', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let adminId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    adminId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Sup', 'Port') RETURNING id`, [
      `retention-${randomUUID()}@example.com`,
    ]);
  });
  afterAll(() => db.close());

  /**
   * Runs `work` in one transaction of the schema owner that is rolled back at the end, so nothing stays behind. Rows are
   * inserted with explicit dates as the owner; `asRole` then switches to an application role for the call under test,
   * still inside the same transaction: now() is the same instant for the inserted dates and for the function.
   */
  async function inRolledBackTransaction<T>(work: (client: pg.PoolClient, asRole: (role: string) => Promise<void>) => Promise<T>): Promise<T> {
    const client = await db.owner.connect();
    try {
      await client.query('BEGIN');
      return await work(client, async (role) => {
        await client.query(role === 'owner' ? 'RESET ROLE' : `SET LOCAL ROLE ${role}`);
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  const purge = async (client: pg.PoolClient, fn: string, limit = 10_000) =>
    (await client.query<{ deleted: number }>(`SELECT ${fn}($1) AS deleted`, [limit])).rows[0]!.deleted;
  const existing = async (client: pg.PoolClient, table: string, ids: string[]) =>
    (await client.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).rows.map((row) => row.id).sort();

  const insertGrant = (client: pg.PoolClient, tenant: SeededTenant, expiresAt: At) =>
    insertReturningId(
      client,
      // Revoked, so that any number of them fit next to the "one grant in force" rule.
      `INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, starts_at, expires_at, revoked_at, created_at)
       VALUES ($1, $2, 'Investigating', ${expiresAt} - interval '1 hour', ${expiresAt}, ${expiresAt}, ${expiresAt} - interval '1 hour') RETURNING id`,
      [tenant.tenantId, tenant.userId],
    );
  const insertSession = (client: pg.PoolClient, tenant: SeededTenant, grantId: string, openedAt: At) =>
    insertReturningId(
      client,
      `INSERT INTO support_sessions (tenant_id, grant_id, platform_user_id, platform_user_label, platform_session_id, opened_at)
       VALUES ($1, $2, $3, 'Sup Port', $4, ${openedAt}) RETURNING id`,
      [tenant.tenantId, grantId, adminId, randomUUID()],
    );
  /** The triggers date every new trail row with now(): the owner backdates it afterwards, inside the test's transaction. */
  const insertAudit = async (client: pg.PoolClient, tenant: SeededTenant, createdAt: At, grantId?: string) => {
    const id = await insertReturningId(
      client,
      grantId === undefined
        ? `INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type) VALUES ($1, $2, 'role.updated', 'Role') RETURNING id`
        : `INSERT INTO audit_logs (tenant_id, action, entity_type, support_actor_id, support_grant_id)
           VALUES ($1, 'support.request', 'Ticket', $3, $2) RETURNING id`,
      grantId === undefined ? [tenant.tenantId, tenant.userId] : [tenant.tenantId, grantId, adminId],
    );
    await client.query(`UPDATE audit_logs SET created_at = ${createdAt} WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
    return id;
  };
  const insertPlatformAudit = async (client: pg.PoolClient, createdAt: At) => {
    const id = await insertReturningId(client, `INSERT INTO platform_audit_logs (actor_user_id, action) VALUES ($1, 'tenant.suspended') RETURNING id`, [adminId]);
    await client.query(`UPDATE platform_audit_logs SET created_at = ${createdAt} WHERE id = $1`, [id]);
    return id;
  };
  const insertNotification = (client: pg.PoolClient, tenant: SeededTenant, createdAt: At, readAt: At | null) =>
    insertReturningId(
      client,
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, created_at, read_at) VALUES ($1, $2, 'SYSTEM', 't', 'b', ${createdAt}, ${readAt ?? 'NULL'}) RETURNING id`,
      [tenant.tenantId, tenant.userId],
    );

  const CASES: RetentionCase[] = [
    {
      fn: 'retention_purge_outbox_events',
      table: 'outbox_events',
      window: '7 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO outbox_events (tenant_id, type, payload, status, processed_at) VALUES ($1, 'ticket.created', '{}', 'DONE', ${at}) RETURNING id`, [tenantA.tenantId]),
    },
    {
      fn: 'retention_purge_outbox_events',
      table: 'outbox_events',
      window: '30 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO outbox_events (tenant_id, type, payload, status, created_at, available_at) VALUES ($1, 'ticket.created', '{}', 'FAILED', ${at}, ${at}) RETURNING id`, [tenantA.tenantId]),
    },
    {
      fn: 'retention_purge_platform_outbox_events',
      table: 'platform_outbox_events',
      window: '7 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO platform_outbox_events (type, payload, status, processed_at) VALUES ('email.password_reset', '{}', 'DONE', ${at}) RETURNING id`),
    },
    {
      fn: 'retention_purge_platform_outbox_events',
      table: 'platform_outbox_events',
      window: '30 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO platform_outbox_events (type, payload, status, created_at, available_at) VALUES ('email.password_reset', '{}', 'FAILED', ${at}, ${at}) RETURNING id`),
    },
    { fn: 'retention_purge_notifications', table: 'notifications', window: '365 days', insert: (client, at) => insertNotification(client, tenantA, at, null) },
    { fn: 'retention_purge_notifications', table: 'notifications', window: '180 days', insert: (client, at) => insertNotification(client, tenantA, `${at} - interval '1 day'`, at) },
    {
      fn: 'retention_purge_refresh_sessions',
      table: 'refresh_sessions',
      window: '30 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, ${at}, ${at} - interval '14 days') RETURNING id`, [
          tenantA.userId,
          tenantA.tenantId,
          hash(),
        ]),
    },
    {
      fn: 'retention_purge_user_tokens',
      table: 'user_tokens',
      window: '30 days',
      insert: (client, at) =>
        insertReturningId(client, `INSERT INTO user_tokens (user_id, type, token_hash, expires_at, created_at) VALUES ($1, 'PASSWORD_RESET', $2, ${at}, ${at} - interval '1 hour') RETURNING id`, [
          tenantA.userId,
          hash(),
        ]),
    },
    { fn: 'retention_purge_audit_logs', table: 'audit_logs', window: '2 years', insert: (client, at) => insertAudit(client, tenantA, at) },
    {
      fn: 'retention_purge_support_sessions',
      table: 'support_sessions',
      window: '2 years',
      insert: async (client, at) => insertSession(client, tenantA, await insertGrant(client, tenantA, `${at} + interval '1 hour'`), at),
    },
    { fn: 'retention_purge_support_access_grants', table: 'support_access_grants', window: '2 years 1 day', insert: (client, at) => insertGrant(client, tenantA, at) },
    { fn: 'retention_purge_platform_audit_logs', table: 'platform_audit_logs', window: '5 years', insert: (client, at) => insertPlatformAudit(client, at) },
  ];

  describe('windows (pinned: a row 1 ms past the window goes, a row 1 ms inside it stays)', () => {
    it.each(CASES)('$fn keeps $table rows younger than $window', async ({ fn, table, window, insert }) => {
      await inRolledBackTransaction(async (client, asRole) => {
        const past = await insert(client, `now() - interval '${window}' - interval '1 millisecond'`);
        const inside = await insert(client, `now() - interval '${window}' + interval '1 millisecond'`);
        await asRole('app_worker');
        expect(await purge(client, fn)).toBeGreaterThanOrEqual(1);
        await asRole('owner');
        expect(await existing(client, table, [past, inside])).toEqual([inside]);
      });
    });

    it.each([
      ['outbox_events', 'retention_purge_outbox_events', `INSERT INTO outbox_events (tenant_id, type, payload, status, created_at, available_at) VALUES ($1, 'ticket.created', '{}', 'PENDING', now() - interval '10 years', now()) RETURNING id`],
      ['outbox_events', 'retention_purge_outbox_events', `INSERT INTO outbox_events (tenant_id, type, payload, status, claim_token, created_at) VALUES ($1, 'ticket.created', '{}', 'PROCESSING', gen_random_uuid(), now() - interval '10 years') RETURNING id`],
      ['platform_outbox_events', 'retention_purge_platform_outbox_events', `INSERT INTO platform_outbox_events (type, payload, status, created_at) VALUES ('email.password_reset', '{}', 'PENDING', now() - interval '10 years') RETURNING id`],
      ['platform_outbox_events', 'retention_purge_platform_outbox_events', `INSERT INTO platform_outbox_events (type, payload, status, claim_token, created_at) VALUES ('email.password_reset', '{}', 'PROCESSING', gen_random_uuid(), now() - interval '10 years') RETURNING id`],
    ])('%s: %s never deletes a pending or in-flight event, whatever its age', async (table, fn, sql) => {
      await inRolledBackTransaction(async (client, asRole) => {
        const id = await insertReturningId(client, sql, table === 'outbox_events' ? [tenantA.tenantId] : []);
        await asRole('app_worker');
        await purge(client, fn);
        await asRole('owner');
        expect(await existing(client, table, [id])).toEqual([id]);
      });
    });

    it.each([
      ['outbox_events', 'retention_purge_outbox_events', `INSERT INTO outbox_events (tenant_id, type, payload, status, created_at, available_at) VALUES ($1, 'ticket.created', '{}', 'FAILED', now() - interval '35 days', now() - interval '1 day') RETURNING id`],
      ['platform_outbox_events', 'retention_purge_platform_outbox_events', `INSERT INTO platform_outbox_events (type, payload, status, created_at, available_at) VALUES ('email.password_reset', '{}', 'FAILED', now() - interval '35 days', now() - interval '1 day') RETURNING id`],
    ])('%s: a FAILED event retried from the console and failed again is kept 30 days from its last attempt', async (table, fn, sql) => {
      await inRolledBackTransaction(async (client, asRole) => {
        const id = await insertReturningId(client, sql, table === 'outbox_events' ? [tenantA.tenantId] : []);
        await asRole('app_worker');
        await purge(client, fn);
        await asRole('owner');
        expect(await existing(client, table, [id])).toEqual([id]);
      });
    });

    it('platform outbox: the real retry, claim and final failure of a 35-day-old event keep it', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const id = await insertReturningId(
          client,
          `INSERT INTO platform_outbox_events (type, payload, status, created_at, available_at) VALUES ('email.password_reset', '{}', 'FAILED', now() - interval '35 days', now() - interval '35 days') RETURNING id`,
        );
        await asRole('app_platform');
        expect((await client.query<{ ok: boolean }>('SELECT retry_failed_platform_outbox_event($1) AS ok', [id])).rows[0]!.ok).toBe(true);
        // A moment later (available_at is now() rounded to milliseconds, which can be just ahead of now() in this transaction).
        await asRole('owner');
        await client.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
        await asRole('app_worker');
        const claimed = (await client.query<{ id: string; claim_token: string }>('SELECT id, claim_token FROM claim_platform_outbox_events(1000)')).rows.find((row) => row.id === id)!;
        await client.query(`SELECT fail_platform_outbox_event($1, $2, 'smtp down', NULL, 10)`, [id, claimed.claim_token]);
        await purge(client, 'retention_purge_platform_outbox_events');
        await asRole('owner');
        expect(await existing(client, 'platform_outbox_events', [id])).toEqual([id]);
      });
    });

    it('notifications: a read one goes 180 days after it was read, however old it is', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const readRecently = await insertNotification(client, tenantA, `now() - interval '3 years'`, `now() - interval '179 days'`);
        const readLongAgo = await insertNotification(client, tenantA, `now() - interval '200 days'`, `now() - interval '181 days'`);
        await asRole('app_worker');
        await purge(client, 'retention_purge_notifications');
        await asRole('owner');
        expect(await existing(client, 'notifications', [readRecently, readLongAgo])).toEqual([readRecently]);
      });
    });
  });

  describe('batches', () => {
    it('deletes at most the limit per call, oldest first, and returns 0 once nothing is left (idempotent)', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const ids = [];
        for (let year = 7; year >= 3; year -= 1) ids.push(await insertAudit(client, tenantA, `now() - interval '${year} years'`));
        await asRole('app_worker');
        expect(await purge(client, 'retention_purge_audit_logs', 2)).toBe(2);
        await asRole('owner');
        expect(await existing(client, 'audit_logs', ids)).toEqual(ids.slice(2).sort());
        await asRole('app_worker');
        expect([await purge(client, 'retention_purge_audit_logs', 2), await purge(client, 'retention_purge_audit_logs', 2)]).toEqual([2, 1]);
        expect(await purge(client, 'retention_purge_audit_logs', 2)).toBe(0);
      });
    });

    it('fills a short outbox batch with old FAILED events after the DONE ones', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const done = await CASES[0]!.insert(client, `now() - interval '8 days'`);
        const failed = await CASES[1]!.insert(client, `now() - interval '31 days'`);
        await asRole('app_worker');
        expect(await purge(client, 'retention_purge_outbox_events', 2)).toBe(2);
        await asRole('owner');
        expect(await existing(client, 'outbox_events', [done, failed])).toEqual([]);
      });
    });

    it('clamps the limit between 1 and 10 000', async () => {
      const { rows } = await db.owner.query<{ low: number; zero: number; high: number; none: number }>(
        'SELECT retention_batch_limit(-5) AS low, retention_batch_limit(0) AS zero, retention_batch_limit(1000000) AS high, retention_batch_limit(NULL) AS none',
      );
      expect(rows[0]).toEqual({ low: 1, zero: 1, high: 10_000, none: 1 });
    });

    it('a concurrent call on the same table returns 0 at once instead of waiting', async () => {
      const holder = await db.owner.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SET LOCAL ROLE app_worker');
        await holder.query('SELECT retention_purge_audit_logs(1)');
        const other = await withoutContext(db.worker, async (client) => purge(client, 'retention_purge_audit_logs'));
        expect(other).toBe(0);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
    });
  });

  describe('tenants', () => {
    it('deletes old rows of every tenant and never a young row of any, whatever tenant the caller has set', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const rows = {
          oldA: await insertAudit(client, tenantA, `now() - interval '3 years'`),
          youngA: await insertAudit(client, tenantA, `now() - interval '1 year'`),
          oldB: await insertAudit(client, tenantB, `now() - interval '3 years'`),
          youngB: await insertAudit(client, tenantB, `now() - interval '1 year'`),
        };
        const others = {
          notificationB: await insertNotification(client, tenantB, `now() - interval '3 years'`, `now() - interval '1 day'`),
          platformAudit: await insertPlatformAudit(client, `now() - interval '3 years'`),
          grantB: await insertGrant(client, tenantB, `now() - interval '3 years'`),
        };
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA.tenantId]);
        await asRole('app_worker');
        await purge(client, 'retention_purge_audit_logs');
        await asRole('owner');
        expect(await existing(client, 'audit_logs', Object.values(rows))).toEqual([rows.youngA, rows.youngB].sort());
        expect(await existing(client, 'notifications', [others.notificationB])).toEqual([others.notificationB]);
        expect(await existing(client, 'platform_audit_logs', [others.platformAudit])).toEqual([others.platformAudit]);
        expect(await existing(client, 'support_access_grants', [others.grantB])).toEqual([others.grantB]);
      });
    });
  });

  describe('app_retention_owner: its policies only show rows past the window', () => {
    it.each([
      ['audit_logs', '2 years'],
      ['platform_audit_logs', '5 years'],
      ['support_sessions', '2 years'],
      ['support_access_grants', '2 years 1 day'],
    ])('%s: a DELETE by explicit id of a young row deletes nothing, even with the tenant set; an old one goes', async (table, window) => {
      const spec = CASES.find((candidate) => candidate.table === table)!;
      await inRolledBackTransaction(async (client, asRole) => {
        const young = await spec.insert(client, `now() - interval '${window}' + interval '1 minute'`);
        const old = await spec.insert(client, `now() - interval '${window}' - interval '1 minute'`);
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA.tenantId]);
        await asRole('app_retention_owner');
        expect((await client.query(`SELECT id FROM ${table} WHERE id = $1`, [young])).rowCount).toBe(0);
        expect((await client.query(`DELETE FROM ${table} WHERE id = $1`, [young])).rowCount).toBe(0);
        expect((await client.query(`DELETE FROM ${table} WHERE id = $1`, [old])).rowCount).toBe(1);
        await asRole('owner');
        expect(await existing(client, table, [young, old])).toEqual([young]);
      });
    });

    it('cannot read the content of the trails, write, or touch any other table', async () => {
      const attempts = [
        `SELECT before, after FROM audit_logs`,
        `SELECT data FROM platform_audit_logs`,
        `UPDATE audit_logs SET action = 'x.y'`,
        `INSERT INTO platform_audit_logs (actor_user_id, action) VALUES (NULL, 'retention.forged')`,
        `DELETE FROM notifications`,
        `DELETE FROM ticket_events`,
        `TRUNCATE audit_logs`,
      ];
      for (const statement of attempts) {
        const state = await sqlStateOf(() =>
          inRolledBackTransaction(async (client, asRole) => {
            await asRole('app_retention_owner');
            await client.query(statement);
          }),
        );
        expect(state, statement).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('is a NOLOGIN role without BYPASSRLS', async () => {
      const { rows } = await db.owner.query(`SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = 'app_retention_owner'`);
      expect(rows).toEqual([{ rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolcreaterole: false }]);
    });
  });

  describe('support history', () => {
    it('keeps an old grant while a visit or an audit row still references it, and deletes it once they are gone', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const old = `now() - interval '3 years'`;
        const withSession = await insertGrant(client, tenantA, old);
        await insertSession(client, tenantA, withSession, `${old} - interval '30 minutes'`);
        const withAudit = await insertGrant(client, tenantA, old);
        await insertAudit(client, tenantA, `${old} - interval '30 minutes'`, withAudit);
        const free = await insertGrant(client, tenantA, old);

        await asRole('app_worker');
        await purge(client, 'retention_purge_support_access_grants');
        await asRole('owner');
        expect(await existing(client, 'support_access_grants', [withSession, withAudit, free])).toEqual([withSession, withAudit].sort());

        await asRole('app_worker');
        for (const fn of ['retention_purge_audit_logs', 'retention_purge_support_sessions', 'retention_purge_support_access_grants']) await purge(client, fn);
        await asRole('owner');
        expect(await existing(client, 'support_access_grants', [withSession, withAudit])).toEqual([]);
      });
    });
  });

  describe('support grants referenced by rows the purge cannot see', () => {
    it('keeps an old grant that a young audit row still references, without failing, and deletes the other old grants', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const old = `now() - interval '3 years'`;
        const referenced = await insertGrant(client, tenantA, old);
        await insertAudit(client, tenantA, `now() - interval '1 year'`, referenced);
        const free = [await insertGrant(client, tenantA, old), await insertGrant(client, tenantA, `${old} + interval '1 day'`)];
        await asRole('app_worker');
        expect(await purge(client, 'retention_purge_support_access_grants')).toBeGreaterThanOrEqual(2);
        expect(await purge(client, 'retention_purge_support_access_grants')).toBe(0);
        await asRole('owner');
        expect(await existing(client, 'support_access_grants', [referenced, ...free])).toEqual([referenced]);
      });
    });

    it('a batch limit counts deleted grants, not skipped ones', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        const old = `now() - interval '3 years'`;
        const referenced = await insertGrant(client, tenantA, `${old} - interval '1 day'`);
        await insertAudit(client, tenantA, `now() - interval '1 year'`, referenced);
        const free = await insertGrant(client, tenantA, old);
        await asRole('app_worker');
        expect(await purge(client, 'retention_purge_support_access_grants', 1)).toBe(1);
        await asRole('owner');
        expect(await existing(client, 'support_access_grants', [referenced, free])).toEqual([referenced]);
      });
    });
  });

  describe('privileges', () => {
    it.each(PURGE_FUNCTIONS)('%s runs only for app_worker', async (fn) => {
      for (const pool of [db.runtime, db.platform]) {
        expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query(`SELECT ${fn}(1)`)))).toBe(SqlState.insufficientPrivilege);
      }
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_worker');
        expect(await purge(client, fn, 1)).toBeGreaterThanOrEqual(0);
      });
    });

    it('the run functions run only for app_worker', async () => {
      for (const pool of [db.runtime, db.platform]) {
        expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query('SELECT retention_start_run()')))).toBe(SqlState.insufficientPrivilege);
        expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query(`SELECT retention_finish_run($1, '{}', '{}', 0, false)`, [randomUUID()])))).toBe(
          SqlState.insufficientPrivilege,
        );
      }
    });

    it('the unbatched purges nothing called are gone', async () => {
      const { rows } = await db.owner.query(
        `SELECT proname FROM pg_proc WHERE proname IN ('purge_processed_outbox_events', 'purge_processed_platform_outbox_events', 'purge_read_notifications')`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe('runs', () => {
    const INVALID_PARAMETER = '22023';
    const startRun = (client: pg.PoolClient) =>
      client
        .query<{ out_run_id: string | null; out_blocking_started_at: Date | null }>('SELECT * FROM retention_start_run()')
        .then((result) => result.rows[0]!);
    const finishRun = (client: pg.PoolClient, runId: string, deleted: unknown, failed: string[] = [], durationMs = 10, interrupted: boolean | null = false) =>
      client.query('SELECT retention_finish_run($1, $2::jsonb, $3::text[], $4, $5)', [runId, JSON.stringify(deleted), failed, durationMs, interrupted]);
    const runRows = (client: pg.PoolClient, runId: string) =>
      client
        .query(`SELECT actor_user_id, action, data FROM platform_audit_logs WHERE id = $1 OR (action = 'retention.run_finished' AND data ->> 'runId' = $1::text) ORDER BY action`, [runId])
        .then((result) => result.rows);

    it('starts one run per 20 hours, says which run blocks the next one, and records the counts without a human actor', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_worker');
        const runId = (await startRun(client)).out_run_id!;
        expect(runId).toEqual(expect.any(String));
        const blocked = await startRun(client);
        expect(blocked).toEqual({ out_run_id: null, out_blocking_started_at: expect.any(Date) });
        await finishRun(client, runId, { audit_logs: 3, notifications: 0 }, ['user_tokens'], 1234, true);
        await asRole('owner');
        expect(await runRows(client, runId)).toEqual([
          { actor_user_id: null, action: 'retention.run_finished', data: { runId, deleted: { audit_logs: 3, notifications: 0 }, failed: ['user_tokens'], durationMs: 1234, interrupted: true } },
          { actor_user_id: null, action: 'retention.run_started', data: {} },
        ]);
        const { rows } = await client.query<{ created_at: Date }>('SELECT created_at FROM platform_audit_logs WHERE id = $1', [runId]);
        expect(blocked.out_blocking_started_at).toEqual(rows[0]!.created_at);
        await client.query(`UPDATE platform_audit_logs SET created_at = now() - interval '20 hours 1 minute' WHERE id = $1`, [runId]);
        await asRole('app_worker');
        expect((await startRun(client)).out_run_id).toEqual(expect.any(String));
      });
    });

    it('accepts the data export expiry step in the run summary (migration 20261017000600)', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_worker');
        const runId = (await startRun(client)).out_run_id!;
        await finishRun(client, runId, { expire_tenant_exports: 2, audit_logs: 0 }, ['expire_tenant_exports']);
        await asRole('owner');
        expect((await runRows(client, runId))[0]).toMatchObject({ data: { deleted: { expire_tenant_exports: 2 }, failed: ['expire_tenant_exports'] } });
      });
    });

    it('a run_started row dated in the future does not switch retention off', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_worker');
        const runId = (await startRun(client)).out_run_id!;
        await asRole('owner');
        await client.query(`UPDATE platform_audit_logs SET created_at = now() + interval '10 years' WHERE id = $1`, [runId]);
        await asRole('app_worker');
        expect((await startRun(client)).out_run_id).toEqual(expect.any(String));
      });
    });

    it('every platform trail row is dated by the database clock, whatever the writer sends', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_platform');
        const { rows } = await client.query<{ dated_now: boolean; inserted: number }>(
          `WITH inserted AS (
             INSERT INTO platform_audit_logs (actor_user_id, action, created_at)
             VALUES ($1, 'tenant.suspended', now() - interval '6 years'), ($1, 'tenant.suspended', now() + interval '1 year')
             RETURNING created_at)
           SELECT bool_and(abs(extract(epoch FROM created_at - now())) < 0.001) AS dated_now, count(*)::int AS inserted FROM inserted`,
          [adminId],
        );
        expect(rows[0]).toEqual({ dated_now: true, inserted: 2 });
      });
    });

    it('rejects a summary with anything but counts of known steps, an unknown run or a second finish', async () => {
      await inRolledBackTransaction(async (client, asRole) => {
        await asRole('app_worker');
        const runId = (await startRun(client)).out_run_id!;
        const attempts: Array<[string, unknown, string[], number, boolean | null]> = [
          [randomUUID(), {}, [], 0, false],
          [runId, { audit_logs: -1 }, [], 0, false],
          [runId, { audit_logs: 1.5 }, [], 0, false],
          [runId, { audit_logs: '3' }, [], 0, false],
          [runId, { tickets: 3 }, [], 0, false],
          [runId, [1], [], 0, false],
          [runId, {}, ['tickets'], 0, false],
          [runId, {}, [], -1, false],
          [runId, {}, [], 0, null],
        ];
        for (const [id, deleted, failed, ms, interrupted] of attempts) {
          await client.query('SAVEPOINT attempt');
          expect(await sqlStateOf(() => finishRun(client, id, deleted, failed, ms, interrupted)), JSON.stringify(deleted)).toBe(INVALID_PARAMETER);
          await client.query('ROLLBACK TO SAVEPOINT attempt');
        }
        await finishRun(client, runId, {});
        expect(await sqlStateOf(() => finishRun(client, runId, {}))).toBe(INVALID_PARAMETER);
      });
    });

    it('two workers starting at the same moment get one run between them', async () => {
      // Committed rows (the only ones in this file): removed by id afterwards, nothing else is touched.
      const claims = await Promise.all([1, 2].map(() => withoutContext(db.worker, (client) => startRun(client))));
      const started = claims.map((claim) => claim.out_run_id).filter((id): id is string => id !== null);
      try {
        expect(started).toHaveLength(1);
        expect(claims.filter((claim) => claim.out_run_id === null)[0]?.out_blocking_started_at).toEqual(expect.any(Date));
      } finally {
        await db.owner.query('DELETE FROM platform_audit_logs WHERE id = ANY($1::uuid[])', [started]);
      }
    });

    it('only retention rows of the platform trail may lack an actor', async () => {
      expect(await sqlStateOf(() => db.platform.query(`INSERT INTO platform_audit_logs (actor_user_id, action) VALUES (NULL, 'tenant.suspended')`))).toBe(SqlState.checkViolation);
    });
  });
});
