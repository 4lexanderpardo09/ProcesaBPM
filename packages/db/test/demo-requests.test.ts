import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId } from './support/fixtures.js';

describe('demo requests from the website (§8.33)', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });
  afterAll(() => db.close());
  // The hourly cap counts every request: each test starts from an empty table.
  beforeEach(() => db.owner.query('DELETE FROM demo_requests'));

  const address = () => `Lead-${randomUUID()}@Example.com`;
  const submit = (email: string, overrides: { name?: string; company?: string; process?: string | null; version?: number } = {}) =>
    withoutContext(db.runtime, async (client) =>
      (
        await client.query<{ id: string }>(`SELECT submit_demo_request($1, $2, $3, 'FROM_20_TO_100', $4, $5::smallint) AS id`, [
          overrides.name ?? '  Laura Méndez ',
          overrides.company ?? 'Distribuidora del Valle',
          email,
          overrides.process === undefined ? '  Anticipos y legalizaciones ' : overrides.process,
          overrides.version ?? 1,
        ])
      ).rows[0]!.id,
    );
  const row = async (id: string) =>
    (await db.owner.query<{ full_name: string; email: string; process: string | null; status: string }>('SELECT full_name, email, process, status FROM demo_requests WHERE id = $1', [id])).rows[0];
  const mails = async (id: string) =>
    (await db.owner.query<{ payload: unknown }>(`SELECT payload FROM platform_outbox_events WHERE type = 'email.demo_request_received' AND payload ->> 'demoRequestId' = $1`, [id])).rows.map((r) => r.payload);

  it('stores the request trimmed and lowercased, and queues one e-mail with only its id', async () => {
    const email = address();
    const id = await submit(email);
    expect(await row(id)).toEqual({ full_name: 'Laura Méndez', email: email.toLowerCase(), process: 'Anticipos y legalizaciones', status: 'NEW' });
    expect(await mails(id)).toEqual([{ demoRequestId: id }]);
  });

  it('a blank process is stored as none', async () => {
    const id = await submit(address(), { process: '   ' });
    expect((await row(id))?.process).toBeNull();
  });

  it('one request per address a day: a repeat (in any case) returns the first and queues nothing', async () => {
    const email = address();
    const first = await submit(email);
    const again = await submit(`  ${email.toUpperCase()} `);
    expect(again).toBe(first);
    expect(await mails(first)).toHaveLength(1);
    expect((await db.owner.query('SELECT 1 FROM demo_requests WHERE email = $1', [email.toLowerCase()])).rowCount).toBe(1);
    await db.owner.query(`UPDATE demo_requests SET created_at = now() - interval '25 hours' WHERE id = $1`, [first]);
    expect(await submit(email)).not.toBe(first);
  });

  it('refuses beyond 100 new requests in the last hour (54000), but still answers a repeat', async () => {
    await db.owner.query(
      `INSERT INTO demo_requests (full_name, company, email, team_size, privacy_notice_version)
       SELECT 'Bulk', 'Bulk Co', 'bulk-' || n || '@example.com', 'UNDER_20', 1 FROM generate_series(1, 100) n`,
    );
    expect(await sqlStateOf(() => submit(address()))).toBe('54000');
    expect(await submit('bulk-7@example.com')).toBeTruthy();
  });

  it('rejects what the form does not allow', async () => {
    expect(await sqlStateOf(() => submit('not-an-email'))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => submit(address(), { name: 'L' }))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => submit(address(), { company: 'x'.repeat(161) }))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => submit(address(), { process: 'x'.repeat(2001) }))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => submit(address(), { version: 0 }))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(`SELECT submit_demo_request(NULL, 'Co', 'a@b.co', 'UNDER_20', NULL, 1::smallint)`)))).toBe('22023');
  });

  it('a handled request says when; a NEW one has no handler', async () => {
    const id = await submit(address());
    const admin = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Sales', 'Person') RETURNING id`, [`sales-${randomUUID()}@example.com`]);
    expect(await sqlStateOf(() => db.platform.query(`UPDATE demo_requests SET status = 'CONTACTED' WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
    expect(await sqlStateOf(() => db.platform.query(`UPDATE demo_requests SET handled_by_id = $2 WHERE id = $1`, [id, admin]))).toBe(SqlState.checkViolation);
    await db.platform.query(`UPDATE demo_requests SET status = 'CONTACTED', handled_at = now(), handled_by_id = $2 WHERE id = $1`, [id, admin]);
    expect((await row(id))?.status).toBe('CONTACTED');
  });

  it('only the platform touches the table; the API and the worker go through their functions', async () => {
    const id = await submit(address());
    for (const pool of [db.runtime, db.worker]) {
      expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query('SELECT id FROM demo_requests')))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query(`INSERT INTO demo_requests (full_name, company, email, team_size, privacy_notice_version) VALUES ('Aa', 'Bb', 'a@b.co', 'UNDER_20', 1)`)))).toBe(
        SqlState.insufficientPrivilege,
      );
    }
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query('SELECT * FROM worker_demo_request($1)', [id])))).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query('SELECT enqueue_demo_request_received($1)', [id])))).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(`SELECT enqueue_platform_event('email.demo_request_received', jsonb_build_object('demoRequestId', $1::text))`, [id])))).toBe(
      SqlState.insufficientPrivilege,
    );
    expect((await db.platform.query('SELECT id FROM demo_requests WHERE id = $1', [id])).rowCount).toBe(1);
  });

  it('the worker reads one request for the e-mail', async () => {
    const email = address();
    const id = await submit(email);
    const read = await withoutContext(db.worker, async (client) => (await client.query('SELECT out_full_name, out_company, out_email, out_team_size, out_process FROM worker_demo_request($1)', [id])).rows);
    expect(read).toEqual([{ out_full_name: 'Laura Méndez', out_company: 'Distribuidora del Valle', out_email: email.toLowerCase(), out_team_size: 'FROM_20_TO_100', out_process: 'Anticipos y legalizaciones' }]);
    expect(await withoutContext(db.worker, async (client) => (await client.query('SELECT * FROM worker_demo_request($1)', [randomUUID()])).rowCount)).toBe(0);
  });

  it('retention deletes requests 24 months old, whatever their status, and only the worker runs it', async () => {
    const old = await submit(address());
    const recent = await submit(address());
    await db.owner.query(`UPDATE demo_requests SET created_at = now() - interval '24 months 1 day' WHERE id = $1`, [old]);
    expect(await sqlStateOf(() => db.platform.query('SELECT retention_purge_demo_requests(100)'))).toBe(SqlState.insufficientPrivilege);
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query('SELECT retention_purge_demo_requests(100)')))).toBe(SqlState.insufficientPrivilege);
    const deleted = await withoutContext(db.worker, async (client) => (await client.query<{ n: number }>('SELECT retention_purge_demo_requests(100) AS n')).rows[0]!.n);
    expect(deleted).toBe(1);
    expect(await row(old)).toBeUndefined();
    expect(await row(recent)).toBeDefined();
  });
});
