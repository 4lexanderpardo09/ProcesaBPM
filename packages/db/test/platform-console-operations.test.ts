import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';

describe('platform outbox operations', () => {
  let db: TestDatabase;
  const created: string[] = [];

  beforeAll(() => {
    db = connectTestDatabase();
  });
  // Leave the shared outbox as it was: other files claim from it.
  afterAll(async () => {
    await db.owner.query('DELETE FROM platform_outbox_events WHERE id = ANY($1::uuid[])', [created]);
    await db.close();
  });
  const track = (id: string) => {
    created.push(id);
    return id;
  };

  const failedEvent = async (lastError = 'smtp refused', payload: object = { userId: randomUUID() }) =>
    track((await db.owner.query<{ id: string }>(
      `INSERT INTO platform_outbox_events (type, payload, status, attempts, last_error) VALUES ('email.password_reset', $1::jsonb, 'FAILED', 10, $2) RETURNING id`,
      [JSON.stringify(payload), lastError],
    )).rows[0]!.id);
  const list = (limit = 50, offset = 0) =>
    withoutContext(db.platform, async (client) =>
      (await client.query<{ out_id: string; out_type: string; out_attempts: number; out_last_error: string; out_total: string }>('SELECT * FROM list_failed_platform_outbox_events($1, $2)', [limit, offset])).rows);
  const retry = (id: string) =>
    withoutContext(db.platform, async (client) => (await client.query<{ ok: boolean }>('SELECT retry_failed_platform_outbox_event($1) AS ok', [id])).rows[0]!.ok);

  it('lists only FAILED events, newest first, with the total, and never the payload', async () => {
    const older = await failedEvent('first', { userId: randomUUID(), secret: 'do-not-show' });
    const newer = await failedEvent('second');
    track((await db.owner.query<{ id: string }>(`INSERT INTO platform_outbox_events (type, payload) VALUES ('email.password_reset', '{}') RETURNING id`)).rows[0]!.id);

    const rows = await list();
    expect(rows.map((row) => row.out_id)).toEqual(expect.arrayContaining([newer, older]));
    expect(rows.findIndex((row) => row.out_id === newer)).toBeLessThan(rows.findIndex((row) => row.out_id === older));
    expect(rows.every((row) => Number(row.out_total) === rows.length)).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual(['out_attempts', 'out_created_at', 'out_id', 'out_last_error', 'out_total', 'out_type']);
    expect(JSON.stringify(rows)).not.toContain('do-not-show');
    expect((await list(1, 0))).toHaveLength(1);
  });

  it('truncates long error messages', async () => {
    const id = await failedEvent('x'.repeat(5000));
    expect((await list()).find((row) => row.out_id === id)!.out_last_error).toHaveLength(500);
  });

  it('queues a FAILED event again with a clean counter, once', async () => {
    const id = await failedEvent();
    expect(await retry(id)).toBe(true);
    const row = (await db.owner.query(`SELECT status, attempts, last_error FROM platform_outbox_events WHERE id = $1`, [id])).rows[0];
    expect(row).toEqual({ status: 'PENDING', attempts: 0, last_error: null });
    expect(await retry(id)).toBe(false);
    expect((await list()).map((r) => r.out_id)).not.toContain(id);
  });

  it('leaves events that are not FAILED alone and ignores unknown ids', async () => {
    const pending = track((await db.owner.query<{ id: string }>(`INSERT INTO platform_outbox_events (type, payload) VALUES ('email.password_reset', '{}') RETURNING id`)).rows[0]!.id);
    expect(await retry(pending)).toBe(false);
    expect(await retry(randomUUID())).toBe(false);
  });

  it('is closed to the API and the worker logins', async () => {
    for (const pool of [db.runtime, db.worker]) {
      expect(await sqlStateOf(() => pool.query('SELECT * FROM list_failed_platform_outbox_events(10, 0)'))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => pool.query('SELECT retry_failed_platform_outbox_event($1)', [randomUUID()]))).toBe(SqlState.insufficientPrivilege);
    }
  });
});
