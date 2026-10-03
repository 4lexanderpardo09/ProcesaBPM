import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claimed {
  id: string;
  tenant_id: string;
  attempts: number;
  status: string;
}

describe('tenant outbox: lease, fencing and complete/fail', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  // available_at has millisecond precision and now() is rounded up to it: an event claimed within the same millisecond
  // would not be due yet. Inserting it a second in the past makes every test deterministic.
  const insertEvent = async (tenant: SeededTenant, type = 'test.lease') =>
    (await db.platform.query<{ id: string }>(
      `INSERT INTO outbox_events (tenant_id, type, payload, available_at) VALUES ($1, $2, '{}', now() - interval '1 second') RETURNING id`,
      [tenant.tenantId, type],
    )).rows[0]!.id;
  const claim = (limit = 1000, lease = '5 minutes', maxAttempts = 10) =>
    withoutContext(db.worker, async (client) => (await client.query<Claimed>('SELECT * FROM claim_outbox_events($1, NULL::text[], $2::interval, $3)', [limit, lease, maxAttempts])).rows);
  const row = async (id: string) =>
    (await db.owner.query<{ status: string; attempts: number; processed_at: Date | null; last_error: string | null; available_at: Date }>(
      'SELECT status, attempts, processed_at, last_error, available_at FROM outbox_events WHERE id = $1', [id])).rows[0]!;
  const asWorker = <T>(tenant: SeededTenant, work: Parameters<typeof withContext<T>>[2]) => withContext(db.worker, { tenantId: tenant.tenantId }, work);
  const complete = (tenant: SeededTenant, id: string, attempt: number) =>
    asWorker(tenant, async (client) => (await client.query<{ ok: boolean }>('SELECT complete_outbox_event($1, $2) AS ok', [id, attempt])).rows[0]!.ok);
  const fail = (tenant: SeededTenant, id: string, attempt: number, retryAt: Date | null, maxAttempts = 10) =>
    asWorker(tenant, async (client) =>
      (await client.query<{ ok: boolean }>('SELECT fail_outbox_event($1, $2, $3, $4, $5) AS ok', [id, attempt, 'boom', retryAt?.toISOString() ?? null, maxAttempts])).rows[0]!.ok);
  const expire = (id: string) => db.owner.query(`UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  it('claims events of every tenant and marks them PROCESSING with a lease', async () => {
    const [a, b] = [await insertEvent(tenantA), await insertEvent(tenantB)];
    const claimed = await claim();
    expect(claimed.filter((event) => [a, b].includes(event.id)).map((event) => event.tenant_id).sort()).toEqual([tenantA.tenantId, tenantB.tenantId].sort());
    expect(await row(a)).toMatchObject({ status: 'PROCESSING', attempts: 1 });
    expect((await row(a)).available_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('a worker that died: the event is claimed again when the lease ends, with one more attempt', async () => {
    const id = await insertEvent(tenantA);
    await claim();
    expect((await claim()).map((event) => event.id)).not.toContain(id);
    await expire(id);
    const again = (await claim()).find((event) => event.id === id)!;
    expect(again.attempts).toBe(2);
  });

  it('an expired lease at the maximum number of attempts ends the event in FAILED', async () => {
    const id = await insertEvent(tenantA);
    await claim(1000, '5 minutes', 1);
    await expire(id);
    expect((await claim(1000, '5 minutes', 1)).map((event) => event.id)).not.toContain(id);
    expect(await row(id)).toMatchObject({ status: 'FAILED', last_error: expect.stringContaining('maximum') });
  });

  it('two workers claiming at the same time get disjoint events', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => insertEvent(tenantA, 'test.race')));
    const [first, second] = await Promise.all([claim(10), claim(10)]);
    const claimedIds = [...first, ...second].map((event) => event.id).filter((id) => ids.includes(id));
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds).toHaveLength(20);
  });

  describe('complete and fail', () => {
    it('complete closes the event inside the handler\'s tenant transaction', async () => {
      const id = await insertEvent(tenantA);
      const { attempts } = (await claim()).find((event) => event.id === id)!;
      expect(await complete(tenantA, id, attempts)).toBe(true);
      expect(await row(id)).toMatchObject({ status: 'DONE', processed_at: expect.any(Date) });
    });

    it('the effect and the completion commit together: a rollback leaves the event claimed, not done', async () => {
      const id = await insertEvent(tenantA);
      const { attempts } = (await claim()).find((event) => event.id === id)!;
      const failing = asWorker(tenantA, async (client) => {
        await client.query('SELECT complete_outbox_event($1, $2)', [id, attempts]);
        throw new Error('the handler failed after completing');
      });
      await expect(failing).rejects.toThrow('the handler failed');
      expect(await row(id)).toMatchObject({ status: 'PROCESSING' });
    });

    it('another tenant\'s context cannot close or fail the event', async () => {
      const id = await insertEvent(tenantA);
      const { attempts } = (await claim()).find((event) => event.id === id)!;
      expect(await complete(tenantB, id, attempts)).toBe(false);
      expect(await fail(tenantB, id, attempts, null)).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'PROCESSING' });
    });

    it('without a tenant context they change nothing', async () => {
      const id = await insertEvent(tenantA);
      const { attempts } = (await claim()).find((event) => event.id === id)!;
      const { rows } = await withoutContext(db.worker, (client) => client.query<{ ok: boolean }>('SELECT complete_outbox_event($1, $2) AS ok', [id, attempts]));
      expect(rows[0]!.ok).toBe(false);
    });

    it('a worker whose lease expired cannot overwrite the result of the new owner (stale attempt)', async () => {
      const id = await insertEvent(tenantA);
      const stale = (await claim()).find((event) => event.id === id)!.attempts;
      await expire(id);
      await claim();
      expect(await complete(tenantA, id, stale)).toBe(false);
      expect(await fail(tenantA, id, stale, null)).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'PROCESSING', attempts: 2 });
    });

    it('fail with a retry goes back to PENDING at that time, and to FAILED on the last allowed attempt', async () => {
      const [retried, last] = [await insertEvent(tenantA), await insertEvent(tenantA)];
      const claimed = await claim(1000, '5 minutes', 1);
      const attemptOf = (id: string) => claimed.find((event) => event.id === id)!.attempts;
      const retryAt = new Date(Date.now() + 60_000);
      expect(await fail(tenantA, retried, attemptOf(retried), retryAt, 10)).toBe(true);
      expect(await row(retried)).toMatchObject({ status: 'PENDING', last_error: 'boom' });
      expect((await row(retried)).available_at.getTime()).toBeGreaterThan(Date.now());
      expect(await fail(tenantA, last, attemptOf(last), retryAt, 1)).toBe(true);
      expect((await row(last)).status).toBe('FAILED');
    });
  });

  describe('privileges', () => {
    it.each([
      ['claim_outbox_events(10, NULL::text[])'],
      [`complete_outbox_event('00000000-0000-4000-8000-000000000000', 1)`],
      [`fail_outbox_event('00000000-0000-4000-8000-000000000000', 1, 'x', NULL, 10)`],
    ])('the API role cannot call %s', async (call) => {
      expect(await sqlStateOf(() => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) => client.query(`SELECT * FROM ${call}`)))).toBe(SqlState.insufficientPrivilege);
    });

    it('the API role only inserts events: it cannot change or delete their state', async () => {
      const id = await insertEvent(tenantA);
      const asApi = (sql: string) => () => withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) => client.query(sql, [id]));
      expect(await sqlStateOf(asApi(`UPDATE outbox_events SET status = 'DONE' WHERE id = $1`))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(asApi('DELETE FROM outbox_events WHERE id = $1'))).toBe(SqlState.insufficientPrivilege);
      await withContext(db.runtime, { tenantId: tenantA.tenantId }, (client) =>
        client.query(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'test.insert', '{}')`, [tenantA.tenantId]));
    });
  });
});
