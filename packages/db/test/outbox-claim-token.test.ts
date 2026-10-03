import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claim {
  id: string;
  attempts: number;
  claim_token: string;
}

interface EventRow {
  status: string;
  attempts: number;
  claim_token: string | null;
  payload: Record<string, unknown>;
}

/** The same protocol on both outboxes; each one is driven exactly the way the worker and the console drive it. */
interface OutboxUnderTest {
  readonly table: 'outbox_events' | 'platform_outbox_events';
  insert(): Promise<string>;
  claim(maxAttempts?: number): Promise<Claim[]>;
  complete(id: string, claimToken: string, pool?: pg.Pool): Promise<boolean>;
  fail(id: string, claimToken: string, retryAt: Date | null): Promise<boolean>;
  isCurrent(id: string, claimToken: string): Promise<boolean>;
  /** What the platform console runs for a FAILED event. */
  retry(id: string): Promise<boolean>;
}

const TENANT_TYPE = 'test.claim_token';

describe('outbox claim tokens', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let otherTenant: SeededTenant;
  const createdPlatformEvents: string[] = [];

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, otherTenant] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  // Leave the shared outboxes as they were: other files claim from them.
  afterAll(async () => {
    await db.owner.query('DELETE FROM platform_outbox_events WHERE id = ANY($1::uuid[])', [createdPlatformEvents]);
    await db.owner.query('DELETE FROM outbox_events WHERE type = $1', [TENANT_TYPE]);
    await db.close();
  });

  const ok = async (result: Promise<pg.QueryResult<{ ok: boolean }>>) => (await result).rows[0]!.ok;
  const retryAtOf = (retryAt: Date | null) => retryAt?.toISOString() ?? null;

  const tenantOutbox: OutboxUnderTest = {
    table: 'outbox_events',
    // available_at has millisecond precision and now() is rounded up to it: a second in the past makes the event due.
    insert: async () =>
      (await db.platform.query<{ id: string }>(
        `INSERT INTO outbox_events (tenant_id, type, payload, available_at) VALUES ($1, $2, '{}', now() - interval '1 second') RETURNING id`,
        [tenant.tenantId, TENANT_TYPE],
      )).rows[0]!.id,
    claim: (maxAttempts = 10) =>
      withoutContext(db.worker, async (client) =>
        (await client.query<Claim>(`SELECT id, attempts, claim_token FROM claim_outbox_events(1000, $1::text[], interval '5 minutes', $2)`, [[TENANT_TYPE], maxAttempts])).rows),
    complete: (id, claimToken, pool = db.worker) =>
      withContext(pool, { tenantId: tenant.tenantId }, (client) => ok(client.query('SELECT complete_outbox_event($1, $2) AS ok', [id, claimToken]))),
    fail: (id, claimToken, retryAt) =>
      withContext(db.worker, { tenantId: tenant.tenantId }, (client) =>
        ok(client.query('SELECT fail_outbox_event($1, $2, $3, $4, 10) AS ok', [id, claimToken, 'boom', retryAtOf(retryAt)]))),
    isCurrent: (id, claimToken) =>
      withContext(db.worker, { tenantId: tenant.tenantId }, (client) => ok(client.query('SELECT outbox_claim_is_current($1, $2) AS ok', [id, claimToken]))),
    // OperationsRepository.retryTenantEvent: app_platform updates the row directly.
    retry: async (id) =>
      ((await db.platform.query(
        `UPDATE outbox_events SET status = 'PENDING', attempts = 0, available_at = now(), last_error = NULL WHERE tenant_id = $1 AND id = $2 AND status = 'FAILED'`,
        [tenant.tenantId, id],
      )).rowCount ?? 0) > 0,
  };

  const platformOutbox: OutboxUnderTest = {
    table: 'platform_outbox_events',
    insert: async () => {
      const id = await withoutContext(db.runtime, async (client) =>
        (await client.query<{ id: string }>(`SELECT enqueue_platform_event('email.password_reset', $1::jsonb) AS id`, [JSON.stringify({ userId: randomUUID(), token: 'secret-token' })])).rows[0]!.id);
      createdPlatformEvents.push(id);
      await db.owner.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
      return id;
    },
    claim: (maxAttempts = 10) =>
      withoutContext(db.worker, async (client) =>
        (await client.query<Claim>(`SELECT id, attempts, claim_token FROM claim_platform_outbox_events(1000, interval '5 minutes', $1)`, [maxAttempts])).rows),
    complete: (id, claimToken, pool = db.worker) => ok(pool.query('SELECT complete_platform_outbox_event($1, $2) AS ok', [id, claimToken])),
    fail: (id, claimToken, retryAt) => ok(db.worker.query('SELECT fail_platform_outbox_event($1, $2, $3, $4, 10) AS ok', [id, claimToken, 'smtp down', retryAtOf(retryAt)])),
    isCurrent: (id, claimToken) => ok(db.worker.query('SELECT platform_outbox_claim_is_current($1, $2) AS ok', [id, claimToken])),
    retry: (id) => ok(db.platform.query('SELECT retry_failed_platform_outbox_event($1) AS ok', [id])),
  };

  describe.each([
    ['tenant outbox', () => tenantOutbox],
    ['platform outbox', () => platformOutbox],
  ])('%s', (_name, outboxOf) => {
    let outbox: OutboxUnderTest;
    beforeAll(() => {
      outbox = outboxOf();
    });

    const row = async (id: string) =>
      (await db.owner.query<EventRow>(`SELECT status, attempts, claim_token, payload FROM ${outbox.table} WHERE id = $1`, [id])).rows[0]!;
    const expire = (id: string) => db.owner.query(`UPDATE ${outbox.table} SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);
    const claimOf = async (id: string, maxAttempts?: number) => (await outbox.claim(maxAttempts)).find((claim) => claim.id === id);

    it('a holder that stalled through a lease, a permanent failure and a console retry cannot touch the new claim with the same attempt number', async () => {
      const id = await outbox.insert();
      const first = (await claimOf(id))!;
      expect(first.attempts).toBe(1);

      await expire(id);
      const second = (await claimOf(id))!;
      expect(second.attempts).toBe(2);
      expect(await outbox.fail(id, second.claim_token, null)).toBe(true);
      expect(await row(id)).toMatchObject({ status: 'FAILED', claim_token: null });

      expect(await outbox.retry(id)).toBe(true);
      await expire(id);
      const third = (await claimOf(id))!;
      // The attempt counter repeats after a retry: only the token tells the two claims apart.
      expect(third.attempts).toBe(first.attempts);

      expect(await outbox.complete(id, first.claim_token)).toBe(false);
      expect(await outbox.fail(id, first.claim_token, null)).toBe(false);
      expect(await outbox.isCurrent(id, first.claim_token)).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'PROCESSING', attempts: 1, claim_token: third.claim_token });

      expect(await outbox.isCurrent(id, third.claim_token)).toBe(true);
      expect(await outbox.complete(id, third.claim_token)).toBe(true);
      expect(await row(id)).toMatchObject({ status: 'DONE', claim_token: null });
    });

    it('every claim issues a new token, kept on the row only while it is PROCESSING', async () => {
      const id = await outbox.insert();
      const first = (await claimOf(id))!;
      expect(await row(id)).toMatchObject({ status: 'PROCESSING', claim_token: first.claim_token });
      await expire(id);
      const second = (await claimOf(id))!;
      expect(second.claim_token).not.toBe(first.claim_token);
      expect(await outbox.isCurrent(id, first.claim_token)).toBe(false);
      expect(await outbox.isCurrent(id, second.claim_token)).toBe(true);
    });

    it('an expired lease is no longer current, even for the token that holds it', async () => {
      const id = await outbox.insert();
      const { claim_token } = (await claimOf(id))!;
      await expire(id);
      expect(await outbox.isCurrent(id, claim_token)).toBe(false);
    });

    it('a retry for later, a permanent failure and a completion all clear the token', async () => {
      const [retried, failed, done] = [await outbox.insert(), await outbox.insert(), await outbox.insert()];
      const claims = await outbox.claim();
      const tokenOf = (id: string) => claims.find((claim) => claim.id === id)!.claim_token;
      expect(await outbox.fail(retried, tokenOf(retried), new Date(Date.now() + 60_000))).toBe(true);
      expect(await outbox.fail(failed, tokenOf(failed), null)).toBe(true);
      expect(await outbox.complete(done, tokenOf(done))).toBe(true);
      expect(await row(retried)).toMatchObject({ status: 'PENDING', claim_token: null });
      expect(await row(failed)).toMatchObject({ status: 'FAILED', claim_token: null });
      expect(await row(done)).toMatchObject({ status: 'DONE', claim_token: null });
    });

    it('the sweep of an expired lease at the maximum number of attempts clears the token', async () => {
      const id = await outbox.insert();
      await claimOf(id, 1);
      await expire(id);
      expect(await claimOf(id, 1)).toBeUndefined();
      expect(await row(id)).toMatchObject({ status: 'FAILED', claim_token: null });
    });

    it('of 10 completions with the same token at the same time, exactly one wins', async () => {
      const id = await outbox.insert();
      const { claim_token } = (await claimOf(id))!;
      const pool = new pg.Pool({ connectionString: inject('workerUrl'), max: 10 });
      try {
        const results = await Promise.all(Array.from({ length: 10 }, () => outbox.complete(id, claim_token, pool)));
        expect(results.filter(Boolean)).toHaveLength(1);
      } finally {
        await pool.end();
      }
    });

    it('the CHECK ties the token to PROCESSING', async () => {
      const id = await outbox.insert();
      expect(await sqlStateOf(() => db.owner.query(`UPDATE ${outbox.table} SET status = 'PROCESSING' WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE ${outbox.table} SET claim_token = gen_random_uuid() WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
      await claimOf(id);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE ${outbox.table} SET status = 'PENDING' WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
    });
  });

  describe('tenant outbox only', () => {
    it('another tenant\'s context, or none, never sees a claim as current', async () => {
      const id = await tenantOutbox.insert();
      const { claim_token } = (await tenantOutbox.claim()).find((claim) => claim.id === id)!;
      const isCurrentIn = (context: { tenantId?: string }) =>
        withContext(db.worker, context, (client) => ok(client.query('SELECT outbox_claim_is_current($1, $2) AS ok', [id, claim_token])));
      expect(await isCurrentIn({ tenantId: otherTenant.tenantId })).toBe(false);
      expect(await isCurrentIn({})).toBe(false);
      expect(await isCurrentIn({ tenantId: tenant.tenantId })).toBe(true);
    });
  });

  describe('platform outbox only', () => {
    const payloadOf = async (id: string) =>
      (await db.owner.query<{ payload: Record<string, unknown> }>('SELECT payload FROM platform_outbox_events WHERE id = $1', [id])).rows[0]!.payload;

    it('final states still remove the token from the payload; a retry for later keeps it', async () => {
      const [retried, failed, done] = [await platformOutbox.insert(), await platformOutbox.insert(), await platformOutbox.insert()];
      const claims = await platformOutbox.claim();
      const tokenOf = (id: string) => claims.find((claim) => claim.id === id)!.claim_token;
      await platformOutbox.fail(retried, tokenOf(retried), new Date(Date.now() + 60_000));
      await platformOutbox.fail(failed, tokenOf(failed), null);
      await platformOutbox.complete(done, tokenOf(done));
      expect(await payloadOf(retried)).toHaveProperty('token', 'secret-token');
      expect(await payloadOf(failed)).not.toHaveProperty('token');
      expect(await payloadOf(done)).not.toHaveProperty('token');
    });
  });

  it('the attempt-fenced signatures are gone and the token-fenced ones belong to the worker only', async () => {
    const { rows } = await db.owner.query<{ fn: string; owner: string; worker: boolean; api: boolean }>(`
      SELECT p.oid::regprocedure::text AS fn, pg_get_userbyid(p.proowner) AS owner,
             has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
             has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS api
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('complete_outbox_event', 'fail_outbox_event', 'outbox_claim_is_current',
                          'complete_platform_outbox_event', 'fail_platform_outbox_event', 'platform_outbox_claim_is_current')
      ORDER BY 1`);

    expect(rows).toEqual([
      { fn: 'complete_outbox_event(uuid,uuid)', owner: 'app_platform', worker: true, api: false },
      { fn: 'complete_platform_outbox_event(uuid,uuid)', owner: 'app_outbox_owner', worker: true, api: false },
      { fn: 'fail_outbox_event(uuid,uuid,text,timestamp with time zone,integer)', owner: 'app_platform', worker: true, api: false },
      { fn: 'fail_platform_outbox_event(uuid,uuid,text,timestamp with time zone,integer)', owner: 'app_outbox_owner', worker: true, api: false },
      { fn: 'outbox_claim_is_current(uuid,uuid)', owner: 'app_platform', worker: true, api: false },
      { fn: 'platform_outbox_claim_is_current(uuid,uuid)', owner: 'app_outbox_owner', worker: true, api: false },
    ]);
  });
});
