import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

const INVALID_PARAMETER_VALUE = '22023';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

describe('security notices', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const newUser = () => seedMember(db.platform, tenant);

  /** Like the login path: no tenant and no user in context. */
  const enqueue = (userId: string, kind: string, sessionId: string | null = null, pool = db.runtime) =>
    withContext(pool, {}, async (client) => {
      const { rows } = await client.query<{ queued: boolean }>('SELECT enqueue_security_notice($1, $2, $3) AS queued', [userId, kind, sessionId]);
      return rows[0]?.queued;
    });

  const noticesOf = async (userId: string) =>
    (
      await db.owner.query<{ payload: Record<string, string>; status: string }>(
        `SELECT payload, status::text AS status FROM platform_outbox_events
         WHERE type = 'email.security_notice' AND payload ->> 'userId' = $1 ORDER BY created_at, id`,
        [userId],
      )
    ).rows;

  describe('enqueue_security_notice', () => {
    it('queues the user id and the kind only, without a tenant or user in context', async () => {
      const userId = await newUser();
      expect(await enqueue(userId, 'PASSWORD_CHANGED')).toBe(true);
      expect(await noticesOf(userId)).toEqual([{ payload: { userId, kind: 'PASSWORD_CHANGED' }, status: 'PENDING' }]);
    });

    it('keeps the session id when one is given', async () => {
      const userId = await newUser();
      const sessionId = randomUUID();
      expect(await enqueue(userId, 'PLATFORM_ADMIN_SIGN_IN', sessionId)).toBe(true);
      expect((await noticesOf(userId))[0]?.payload).toEqual({ userId, kind: 'PLATFORM_ADMIN_SIGN_IN', sessionId });
    });

    it.each(['UNKNOWN', 'password_changed', ''])('refuses the kind %j with 22023', async (kind) => {
      const userId = await newUser();
      expect(await sqlStateOf(() => enqueue(userId, kind))).toBe(INVALID_PARAMETER_VALUE);
      expect(await noticesOf(userId)).toEqual([]);
    });

    it('queues nothing for an unknown account', async () => {
      const userId = randomUUID();
      expect(await enqueue(userId, 'PASSWORD_RESET')).toBe(false);
      expect(await noticesOf(userId)).toEqual([]);
    });

    it.each(['ACCOUNT_LOCKED', 'MFA_LOCKED'])('queues at most one %s per user in 24 hours', async (kind) => {
      const userId = await newUser();
      expect(await enqueue(userId, kind)).toBe(true);
      expect(await enqueue(userId, kind)).toBe(false);
      expect(await noticesOf(userId)).toHaveLength(1);

      await db.owner.query(`UPDATE platform_outbox_events SET created_at = now() - interval '25 hours' WHERE payload ->> 'userId' = $1`, [userId]);
      expect(await enqueue(userId, kind)).toBe(true);
      expect(await noticesOf(userId)).toHaveLength(2);
    });

    it('deduplicates each lock kind on its own and per user', async () => {
      const userId = await newUser();
      const other = await newUser();
      expect(await enqueue(userId, 'ACCOUNT_LOCKED')).toBe(true);
      expect(await enqueue(userId, 'MFA_LOCKED')).toBe(true);
      expect(await enqueue(other, 'ACCOUNT_LOCKED')).toBe(true);
    });

    it('queues one lock notice when 10 run in parallel', async () => {
      const userId = await newUser();
      const pool = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 10 });
      try {
        const results = await Promise.all(Array.from({ length: 10 }, () => enqueue(userId, 'ACCOUNT_LOCKED', null, pool)));
        expect(results.filter(Boolean)).toHaveLength(1);
      } finally {
        await pool.end();
      }
      expect(await noticesOf(userId)).toHaveLength(1);
    });

    it.each(['PASSWORD_CHANGED', 'PASSWORD_RESET', 'MFA_ENABLED', 'MFA_DISABLED', 'MFA_BACKUP_CODES_REGENERATED', 'MFA_RESET_BY_SUPPORT', 'PLATFORM_ADMIN_SIGN_IN'])(
      'does not deduplicate %s (a deliberate action of the account or of support)',
      async (kind) => {
        const userId = await newUser();
        expect(await enqueue(userId, kind)).toBe(true);
        expect(await enqueue(userId, kind)).toBe(true);
        expect(await noticesOf(userId)).toHaveLength(2);
      },
    );
  });

  describe('privileges', () => {
    it('lets the API and the platform login queue a notice', async () => {
      const userId = await newUser();
      expect(await enqueue(userId, 'MFA_ENABLED', null, db.runtime)).toBe(true);
      expect(await enqueue(userId, 'MFA_ENABLED', null, db.platform)).toBe(true);
    });

    it('refuses the event type through enqueue_platform_event, so the kinds and the dedupe cannot be skipped', async () => {
      const userId = await newUser();
      for (const pool of [db.runtime, db.platform]) {
        expect(
          await sqlStateOf(() =>
            withContext(pool, {}, (client) =>
              client.query(`SELECT enqueue_platform_event('email.security_notice', $1::jsonb)`, [JSON.stringify({ userId, kind: 'ACCOUNT_LOCKED' })]),
            ),
          ),
        ).toBe(SqlState.insufficientPrivilege);
      }
      expect(await noticesOf(userId)).toEqual([]);
    });

    it('gives no application role direct access to the queue (the dedupe read happens inside the function)', async () => {
      const userId = await newUser();
      for (const pool of [db.runtime, db.worker, db.platform]) {
        expect(await sqlStateOf(() => pool.query('SELECT 1 FROM platform_outbox_events LIMIT 1'))).toBe(SqlState.insufficientPrivilege);
        expect(
          await sqlStateOf(() =>
            pool.query(`INSERT INTO platform_outbox_events (type, payload) VALUES ('email.security_notice', $1::jsonb)`, [JSON.stringify({ userId, kind: 'ACCOUNT_LOCKED' })]),
          ),
        ).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('keeps the existence check and the recipient lookup closed to the API', async () => {
      for (const pool of [db.runtime, db.worker]) {
        expect(await sqlStateOf(() => pool.query('SELECT security_notice_user_exists($1)', [randomUUID()]))).toBe(SqlState.insufficientPrivilege);
      }
      // app_platform owns it, like the other worker_* functions.
      expect(await sqlStateOf(() => db.runtime.query('SELECT * FROM worker_security_notice_recipient($1, NULL)', [randomUUID()]))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('worker_security_notice_recipient', () => {
    const recipient = async (userId: string, sessionId: string | null) =>
      (await db.worker.query('SELECT * FROM worker_security_notice_recipient($1, $2)', [userId, sessionId])).rows;
    const newSession = async (userId: string) =>
      (
        await db.owner.query<{ id: string }>(
          `INSERT INTO refresh_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
           VALUES ($1, $2, now() + interval '1 hour', '203.0.113.7', 'Agent/1.0') RETURNING id`,
          [userId, randomUUID()],
        )
      ).rows[0]!.id;

    it('returns the address, the time zone and the sign-in origin of the user’s own session', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET time_zone = 'America/Lima' WHERE id = $1`, [userId]);
      const sessionId = await newSession(userId);
      const [row] = await recipient(userId, sessionId);
      expect(row).toMatchObject({ out_time_zone: 'America/Lima', out_ip_address: '203.0.113.7', out_user_agent: 'Agent/1.0' });
      expect(row.out_email).toContain('@');
    });

    it('does not show the session of another user', async () => {
      const userId = await newUser();
      const sessionId = await newSession(await newUser());
      expect(await recipient(userId, sessionId)).toEqual([expect.objectContaining({ out_ip_address: null, out_user_agent: null })]);
    });

    it('returns nothing for a disabled or unknown account', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [userId]);
      expect(await recipient(userId, null)).toEqual([]);
      expect(await recipient(randomUUID(), null)).toEqual([]);
    });
  });

  describe('claims that return the claim number', () => {
    const claimLogin = (userId: string, pool = db.runtime) =>
      withContext(pool, {}, async (client) => {
        const { rows } = await client.query<{ claim: number | null }>('SELECT auth_claim_login_attempt_counted($1, $2, $3) AS claim', [userId, MAX_FAILED, LOCK_MINUTES]);
        return rows[0]!.claim;
      });
    const claimMfa = (userId: string, pool = db.runtime) =>
      withContext(pool, { userId }, async (client) => {
        const { rows } = await client.query<{ claim: number | null }>('SELECT auth_claim_mfa_attempt_counted($1, $2) AS claim', [MAX_FAILED, LOCK_MINUTES]);
        return rows[0]!.claim;
      });

    it.each([
      ['login', claimLogin],
      ['second factor', claimMfa],
    ] as const)('numbers the %s claims 1..5 and refuses the rest with NULL when 20 run in parallel', async (_name, claim) => {
      const userId = await newUser();
      const pool = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 20 });
      try {
        const results = await Promise.all(Array.from({ length: 20 }, () => claim(userId, pool)));
        expect(results.filter((value) => value !== null).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
        expect(results.filter((value) => value === null)).toHaveLength(15);
      } finally {
        await pool.end();
      }
    });

    it('returns NULL for an unknown or disabled account, and a number above the maximum after the lock expires', async () => {
      expect(await claimLogin(randomUUID())).toBeNull();
      const disabled = await newUser();
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled]);
      expect(await claimLogin(disabled)).toBeNull();

      const userId = await newUser();
      await db.owner.query(`UPDATE users SET failed_logins = 5, locked_until = now() - interval '1 second', mfa_failed_attempts = 5, mfa_locked_until = now() - interval '1 second' WHERE id = $1`, [userId]);
      expect(await claimLogin(userId)).toBe(6);
      expect(await claimLogin(userId)).toBeNull();
      expect(await claimMfa(userId)).toBe(6);
      expect(await claimMfa(userId)).toBeNull();
    });

    it('needs an authenticated user for the second-factor claim', async () => {
      expect(await sqlStateOf(() => withContext(db.runtime, {}, (client) => client.query('SELECT auth_claim_mfa_attempt_counted(5, 15)')))).toBe(SqlState.insufficientPrivilege);
    });

    it('leaves the boolean claims of the previous API version working', async () => {
      const userId = await newUser();
      const login = await withContext(db.runtime, {}, async (client) => (await client.query('SELECT auth_claim_login_attempt($1, 5, 15) AS ok', [userId])).rows[0].ok);
      const mfa = await withContext(db.runtime, { userId }, async (client) => (await client.query('SELECT auth_claim_mfa_attempt(5, 15) AS ok')).rows[0].ok);
      expect([login, mfa]).toEqual([true, true]);
      expect(await claimLogin(userId)).toBe(2);
      expect(await claimMfa(userId)).toBe(2);
    });
  });
});
