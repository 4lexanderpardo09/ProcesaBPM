import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';

const INVALID_PARAMETER = '22023';

describe('e-mail suppressions from SES bounces and complaints (§8.34)', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });
  afterAll(() => db.close());

  const address = () => `Bounced-${randomUUID()}@Acme.co`;
  const record = (email: string, reason: 'BOUNCE' | 'COMPLAINT', detail: string | null, feedbackId: string | null) =>
    withoutContext(db.runtime, async (client) =>
      (await client.query<{ ok: boolean }>('SELECT record_email_suppression($1, $2::email_suppression_reason, $3, $4) AS ok', [email, reason, detail, feedbackId])).rows[0]!.ok,
    );
  const suppressed = (email: string) =>
    withoutContext(db.worker, async (client) => (await client.query<{ ok: boolean }>('SELECT worker_suppressed_email($1) AS ok', [email])).rows[0]!.ok);
  const row = async (email: string) =>
    (await db.owner.query<{ email: string; reason: string; detail: string | null; events: number }>('SELECT email, reason, detail, events FROM email_suppressions WHERE email = lower($1)', [email])).rows[0];

  it('records an address trimmed and lowercased, and the worker finds it whatever its case', async () => {
    const email = address();
    expect(await record(`  ${email} `, 'BOUNCE', 'Permanent/General', 'feedback-1')).toBe(true);
    expect(await row(email)).toEqual({ email: email.toLowerCase(), reason: 'BOUNCE', detail: 'Permanent/General', events: 1 });
    expect(await suppressed(email.toUpperCase())).toBe(true);
    expect(await suppressed(address())).toBe(false);
  });

  it('ignores the same notification delivered twice, and counts a new one, keeping its reason', async () => {
    const email = address();
    await record(email, 'BOUNCE', 'Permanent/General', 'feedback-1');
    expect(await record(email, 'BOUNCE', 'Permanent/General', 'feedback-1')).toBe(false);
    expect((await row(email))!.events).toBe(1);
    expect(await record(email, 'COMPLAINT', 'abuse', 'feedback-2')).toBe(true);
    expect(await row(email)).toMatchObject({ reason: 'COMPLAINT', detail: 'abuse', events: 2 });
  });

  it('refuses what is not an address, and bounds the detail', async () => {
    for (const email of ['', 'no-at-sign', `${'a'.repeat(250)}@acme.co`]) {
      expect(await sqlStateOf(() => record(email, 'BOUNCE', null, null)), email.slice(0, 20)).toBe(INVALID_PARAMETER);
    }
    const email = address();
    await record(email, 'BOUNCE', 'x'.repeat(500), 'y'.repeat(500));
    expect((await row(email))!.detail).toHaveLength(200);
  });

  it('is the platform’s: the API only records, the worker only asks about one address (it inherits the API role, never the table), the console lists and removes', async () => {
    const email = address();
    await record(email, 'BOUNCE', null, null);
    for (const sql of ['SELECT * FROM email_suppressions', `INSERT INTO email_suppressions (email, reason) VALUES ('x@acme.co', 'BOUNCE')`, 'DELETE FROM email_suppressions']) {
      expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(sql))), `runtime: ${sql}`).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => withoutContext(db.worker, (client) => client.query(sql))), `worker: ${sql}`).toBe(SqlState.insufficientPrivilege);
    }
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query(`SELECT worker_suppressed_email('x@acme.co')`)))).toBe(SqlState.insufficientPrivilege);

    const listed = await withoutContext(db.platform, async (client) => (await client.query<{ email: string }>('SELECT email FROM email_suppressions WHERE email = lower($1)', [email])).rows);
    expect(listed).toEqual([{ email: email.toLowerCase() }]);
    await withoutContext(db.platform, (client) => client.query('DELETE FROM email_suppressions WHERE email = lower($1)', [email]));
    expect(await suppressed(email)).toBe(false);
  });

  it('keeps the rules in the table too, should anything write it directly', async () => {
    for (const sql of [
      `INSERT INTO email_suppressions (email, reason) VALUES ('Upper@Acme.co', 'BOUNCE')`,
      `INSERT INTO email_suppressions (email, reason, events) VALUES ('${randomUUID()}@acme.co', 'BOUNCE', 0)`,
      `INSERT INTO email_suppressions (email, reason, detail) VALUES ('${randomUUID()}@acme.co', 'BOUNCE', repeat('x', 201))`,
    ]) {
      expect(await sqlStateOf(() => db.owner.query(sql)), sql).toBe(SqlState.checkViolation);
    }
  });
});
