import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

describe('login attempts and one-use tokens', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const newUser = async () => {
    const userId = await seedMember(db.platform, tenant);
    await db.owner.query(`UPDATE users SET password_hash = 'old-hash' WHERE id = $1`, [userId]);
    return userId;
  };
  const claim = (userId: string, pool = db.runtime) =>
    withContext(pool, {}, async (client) => {
      const { rows } = await client.query<{ claimed: boolean }>('SELECT auth_claim_login_attempt($1, $2, $3) AS claimed', [userId, MAX_FAILED, LOCK_MINUTES]);
      return rows[0]?.claimed;
    });
  const lockState = async (userId: string) => {
    const { rows } = await db.owner.query<{ failed_logins: number; locked: boolean | null }>(
      'SELECT failed_logins, locked_until > now() AS locked FROM users WHERE id = $1',
      [userId],
    );
    return rows[0];
  };

  describe('auth_claim_login_attempt', () => {
    it('counts every claim and locks the account when the maximum is reached', async () => {
      const userId = await newUser();
      for (let i = 1; i < MAX_FAILED; i += 1) expect(await claim(userId)).toBe(true);
      expect(await lockState(userId)).toEqual({ failed_logins: MAX_FAILED - 1, locked: null });
      expect(await claim(userId)).toBe(true);
      expect(await lockState(userId)).toEqual({ failed_logins: MAX_FAILED, locked: true });
    });

    it('refuses claims while locked, without growing the counter', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET failed_logins = 5, locked_until = now() + interval '1 hour' WHERE id = $1`, [userId]);
      expect(await claim(userId)).toBe(false);
      expect(await lockState(userId)).toEqual({ failed_logins: 5, locked: true });
    });

    it('allows one attempt after the lock expires and locks again at once (the counter does not decay)', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET failed_logins = 5, locked_until = now() - interval '1 second' WHERE id = $1`, [userId]);
      expect(await claim(userId)).toBe(true);
      expect(await lockState(userId)).toEqual({ failed_logins: 6, locked: true });
      expect(await claim(userId)).toBe(false);
    });

    it.each(['DISABLED', 'LOCKED'])('refuses a %s account and an unknown id', async (status) => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);
      expect(await claim(userId)).toBe(false);
      expect(await claim(randomUUID())).toBe(false);
    });

    it('lets exactly the maximum number of claims through when 20 run in parallel', async () => {
      const userId = await newUser();
      const pool = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 20 });
      try {
        const results = await Promise.all(Array.from({ length: 20 }, () => claim(userId, pool)));
        expect(results.filter(Boolean)).toHaveLength(MAX_FAILED);
        expect(await lockState(userId)).toEqual({ failed_logins: MAX_FAILED, locked: true });
      } finally {
        await pool.end();
      }
    });
  });

  describe('auth_record_password_success', () => {
    it('gives the slot back and stamps the last login only when the sign-in is complete', async () => {
      const userId = await newUser();
      await claim(userId);
      await claim(userId);
      const record = (signedIn: boolean) => withContext(db.runtime, {}, (client) => client.query('SELECT auth_record_password_success($1, $2)', [userId, signedIn]));

      await record(false);
      const pending = await db.owner.query<{ failed_logins: number; last_login_at: Date | null }>('SELECT failed_logins, last_login_at FROM users WHERE id = $1', [userId]);
      expect(pending.rows[0]).toEqual({ failed_logins: 0, last_login_at: null });
      await record(true);
      const done = await db.owner.query<{ last_login_at: Date | null }>('SELECT last_login_at FROM users WHERE id = $1', [userId]);
      expect(done.rows[0]?.last_login_at).not.toBeNull();
    });
  });

  describe('auth_consume_login_token', () => {
    const consume = (input: { jti?: string; userId: string; issuedAt?: Date; expiresAt?: Date; purpose?: string }, pool = db.runtime) =>
      withContext(pool, {}, async (client) => {
        const { rows } = await client.query<{ ok: boolean }>('SELECT auth_consume_login_token($1, $2, $3, $4, $5) AS ok', [
          input.jti ?? randomUUID(),
          input.userId,
          input.purpose ?? 'TENANT_SELECTION',
          input.issuedAt ?? new Date(Date.now() - 1_000),
          input.expiresAt ?? new Date(Date.now() + 120_000),
        ]);
        return rows[0]?.ok;
      });

    it('accepts a token once', async () => {
      const userId = await newUser();
      const jti = randomUUID();
      expect(await consume({ jti, userId })).toBe(true);
      expect(await consume({ jti, userId })).toBe(false);
    });

    it('refuses a token issued before, or in the same instant as, the last password change', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET password_changed_at = now() WHERE id = $1`, [userId]);
      expect(await consume({ userId, issuedAt: new Date(Date.now() - 60_000) })).toBe(false);
      expect(await consume({ userId, issuedAt: new Date(Date.now() + 5_000) })).toBe(true);
    });

    it('refuses an account that is not ACTIVE', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [userId]);
      expect(await consume({ userId })).toBe(false);
    });

    it('lets exactly one of several parallel consumptions of the same token win', async () => {
      const userId = await newUser();
      const jti = randomUUID();
      const results = await Promise.all(Array.from({ length: 4 }, () => consume({ jti, userId })));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('is not readable or writable as a table by the application roles', async () => {
      for (const pool of [db.runtime, db.worker]) {
        expect(await sqlStateOf(() => withContext(pool, {}, (client) => client.query('SELECT * FROM consumed_auth_tokens')))).toBe(SqlState.insufficientPrivilege);
      }
    });
  });

  describe('purge_consumed_auth_tokens', () => {
    it('deletes only tokens that expired more than an hour ago and only the worker may run it', async () => {
      const userId = await newUser();
      await db.owner.query(
        `INSERT INTO consumed_auth_tokens (jti, user_id, purpose, expires_at) VALUES
           ($1, $3, 'TENANT_SELECTION', now() - interval '2 hours'), ($2, $3, 'TENANT_SELECTION', now() + interval '1 minute')`,
        [randomUUID(), randomUUID(), userId],
      );
      expect(await sqlStateOf(() => withContext(db.runtime, {}, (client) => client.query('SELECT purge_consumed_auth_tokens()')))).toBe(SqlState.insufficientPrivilege);

      const purged = await withContext(db.worker, {}, async (client) => (await client.query<{ n: string }>('SELECT purge_consumed_auth_tokens() AS n')).rows[0]?.n);
      expect(Number(purged)).toBeGreaterThanOrEqual(1);
      const left = await db.owner.query('SELECT 1 FROM consumed_auth_tokens WHERE user_id = $1', [userId]);
      expect(left.rowCount).toBe(1);
    });
  });

  describe('password changes', () => {
    it('auth_change_own_password sets the hash and timestamp, clears the lockout and keeps only the given session', async () => {
      const userId = await newUser();
      await db.owner.query(`UPDATE users SET failed_logins = 3, locked_until = now() + interval '1 hour' WHERE id = $1`, [userId]);
      const session = async () =>
        (await db.owner.query<{ id: string }>(
          `INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
          [userId, hashToken(randomUUID())],
        )).rows[0]!.id;
      const kept = await session();
      const other = await session();

      await withContext(db.runtime, { userId }, (client) => client.query('SELECT auth_change_own_password($1, $2)', ['new-hash', kept]));

      const user = await db.owner.query<{ password_hash: string; failed_logins: number; locked_until: Date | null; changed: boolean }>(
        'SELECT password_hash, failed_logins, locked_until, password_changed_at IS NOT NULL AS changed FROM users WHERE id = $1',
        [userId],
      );
      expect(user.rows[0]).toEqual({ password_hash: 'new-hash', failed_logins: 0, locked_until: null, changed: true });
      const revoked = await db.owner.query<{ id: string; revoked: boolean }>('SELECT id, revoked_at IS NOT NULL AS revoked FROM refresh_sessions WHERE user_id = $1', [userId]);
      expect(Object.fromEntries(revoked.rows.map((row) => [row.id, row.revoked]))).toEqual({ [kept]: false, [other]: true });
    });

    it('auth_change_own_password needs an authenticated user', async () => {
      expect(await sqlStateOf(() => withContext(db.runtime, {}, (client) => client.query('SELECT auth_change_own_password($1, NULL)', ['x'])))).toBe(SqlState.insufficientPrivilege);
    });

    it('a consumed password reset records the change time', async () => {
      const userId = await newUser();
      const token = randomUUID();
      await withContext(db.platform, {}, (client) => client.query(`SELECT auth_issue_user_token($1, 'PASSWORD_RESET', $2, $3)`, [userId, hashToken(token), new Date(Date.now() + 3_600_000)]));
      await withContext(db.runtime, {}, (client) => client.query('SELECT * FROM auth_consume_user_token($1, $2)', [hashToken(token), 'reset-hash']));
      const { rows } = await db.owner.query<{ changed: boolean }>('SELECT password_changed_at IS NOT NULL AS changed FROM users WHERE id = $1', [userId]);
      expect(rows[0]?.changed).toBe(true);
    });
  });
});
