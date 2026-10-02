import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tenHashes = () => Array.from({ length: 10 }, () => hash(randomUUID()));

describe('two-step verification (MFA)', () => {
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
  const asUser = <T>(userId: string, work: (client: pg.PoolClient) => Promise<T>, pool = db.runtime) => withContext(pool, { userId }, work);
  const scalar = <T>(userId: string, sql: string, params: unknown[] = []) =>
    asUser(userId, async (client) => (await client.query<{ value: T }>(`SELECT ${sql} AS value`, params)).rows[0]?.value);
  const sessionsOf = async (userId: string) =>
    (await db.owner.query<{ id: string; revoked: boolean; mfa_verified: boolean }>('SELECT id, revoked_at IS NOT NULL AS revoked, mfa_verified FROM refresh_sessions WHERE user_id = $1', [userId])).rows;
  const addSession = async (userId: string) =>
    (await db.owner.query<{ id: string }>(`INSERT INTO refresh_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`, [userId, hash(randomUUID())])).rows[0]!.id;

  /** Pending secret stored, first code accepted at `step`, MFA enabled with the given backup hashes. */
  async function enroll(userId: string, hashes = tenHashes(), keepSession: string | null = null, step = 100) {
    await scalar(userId, 'auth_store_pending_mfa_secret($1)', [Buffer.from('ciphertext')]);
    expect(await scalar(userId, 'auth_accept_totp_step($1, false)', [step])).toBe(true);
    await asUser(userId, (client) => client.query('SELECT auth_enable_mfa($1, $2)', [hashes, keepSession]));
    return hashes;
  }

  describe('every function needs an authenticated user', () => {
    it.each([
      'auth_mfa_status()',
      "auth_store_pending_mfa_secret('\\x01')",
      'auth_claim_mfa_attempt(5, 15)',
      'auth_accept_totp_step(1, true)',
      "auth_use_backup_code('x')",
      'auth_replace_backup_codes(ARRAY[]::text[])',
      'auth_disable_mfa(NULL)',
      "auth_reencrypt_mfa_secret('\\x01', '\\x02')",
    ])('%s', async (call) => {
      expect(await sqlStateOf(() => withContext(db.runtime, {}, (client) => client.query(`SELECT ${call}`)))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('enrollment', () => {
    it('stores a pending secret, enables MFA once the first code was accepted and keeps the codes', async () => {
      const userId = await newUser();
      const hashes = await enroll(userId);
      const status = await asUser(userId, async (client) => (await client.query('SELECT * FROM auth_mfa_status()')).rows[0]);
      expect(status).toMatchObject({ enabled: true, backup_codes_left: 10 });
      expect(status.secret_encrypted).toEqual(Buffer.from('ciphertext'));
      expect(hashes).toHaveLength(10);
    });

    it('does not enable MFA before a code was accepted', async () => {
      const userId = await newUser();
      await scalar(userId, 'auth_store_pending_mfa_secret($1)', [Buffer.from('ciphertext')]);
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('SELECT auth_enable_mfa($1, NULL)', [tenHashes()])))).toBe(SqlState.checkViolation);
    });

    it('refuses to replace the secret of an account that has MFA on', async () => {
      const userId = await newUser();
      await enroll(userId);
      expect(await sqlStateOf(() => scalar(userId, 'auth_store_pending_mfa_secret($1)', [Buffer.from('other')]))).toBe(SqlState.checkViolation);
    });

    it.each([
      ['nine codes', () => tenHashes().slice(1)],
      ['a repeated code', () => [...tenHashes().slice(2), hash('x'), hash('x')]],
      ['a value that is not a SHA-256 hex', () => [...tenHashes().slice(1), 'plain-code']],
    ])('refuses %s', async (_label, build) => {
      const userId = await newUser();
      await scalar(userId, 'auth_store_pending_mfa_secret($1)', [Buffer.from('ciphertext')]);
      await scalar(userId, 'auth_accept_totp_step($1, false)', [5]);
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('SELECT auth_enable_mfa($1, NULL)', [build()])))).toBe(SqlState.checkViolation);
    });

    it('revokes the other sessions and marks the one that enrolled as verified', async () => {
      const userId = await newUser();
      const [keep, other] = [await addSession(userId), await addSession(userId)];
      await enroll(userId, tenHashes(), keep);
      const sessions = Object.fromEntries((await sessionsOf(userId)).map((row) => [row.id, row]));
      expect(sessions[keep]).toMatchObject({ revoked: false, mfa_verified: true });
      expect(sessions[other]).toMatchObject({ revoked: true });
    });

    it('cannot leave MFA enabled without a secret (CHECK)', async () => {
      const userId = await newUser();
      expect(await sqlStateOf(() => db.owner.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [userId]))).toBe(SqlState.checkViolation);
    });
  });

  describe('replay protection (auth_accept_totp_step)', () => {
    it('accepts a step once and never an equal or older one', async () => {
      const userId = await newUser();
      await enroll(userId, tenHashes(), null, 100);
      expect(await scalar(userId, 'auth_accept_totp_step($1, true)', [100])).toBe(false);
      expect(await scalar(userId, 'auth_accept_totp_step($1, true)', [99])).toBe(false);
      expect(await scalar(userId, 'auth_accept_totp_step($1, true)', [101])).toBe(true);
      expect(await scalar(userId, 'auth_accept_totp_step($1, true)', [101])).toBe(false);
    });

    it('lets exactly one of several concurrent submissions of the same step win', async () => {
      const userId = await newUser();
      await enroll(userId, tenHashes(), null, 10);
      const pool = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 8 });
      try {
        const accepted = await Promise.all(Array.from({ length: 8 }, () => asUser(userId, async (client) => (await client.query<{ ok: boolean }>('SELECT auth_accept_totp_step($1, true) AS ok', [11])).rows[0]!.ok, pool)));
        expect(accepted.filter(Boolean)).toHaveLength(1);
      } finally {
        await pool.end();
      }
    });

    it('verifies the pending secret only with enabled = false, and the active one only with enabled = true', async () => {
      const userId = await newUser();
      await scalar(userId, 'auth_store_pending_mfa_secret($1)', [Buffer.from('ciphertext')]);
      expect(await scalar(userId, 'auth_accept_totp_step($1, true)', [5])).toBe(false);
      expect(await scalar(userId, 'auth_accept_totp_step($1, false)', [5])).toBe(true);
    });
  });

  describe('attempts (auth_claim_mfa_attempt)', () => {
    it('lets exactly five claims through when 20 run in parallel, then refuses', async () => {
      const userId = await newUser();
      await enroll(userId);
      const pool = new pg.Pool({ connectionString: inject('runtimeUrl'), max: 20 });
      try {
        const claims = await Promise.all(Array.from({ length: 20 }, () => withContext(pool, { userId }, async (client) => (await client.query<{ ok: boolean }>('SELECT auth_claim_mfa_attempt(5, 15) AS ok')).rows[0]!.ok)));
        expect(claims.filter(Boolean)).toHaveLength(5);
      } finally {
        await pool.end();
      }
      expect(await scalar(userId, 'auth_claim_mfa_attempt(5, 15)')).toBe(false);
    });

    it('a good code gives the attempts back', async () => {
      const userId = await newUser();
      await enroll(userId, tenHashes(), null, 1);
      await scalar(userId, 'auth_claim_mfa_attempt(5, 15)');
      await scalar(userId, 'auth_claim_mfa_attempt(5, 15)');
      await scalar(userId, 'auth_accept_totp_step($1, true)', [2]);
      const row = (await db.owner.query<{ mfa_failed_attempts: number; mfa_locked_until: Date | null }>('SELECT mfa_failed_attempts, mfa_locked_until FROM users WHERE id = $1', [userId])).rows[0];
      expect(row).toEqual({ mfa_failed_attempts: 0, mfa_locked_until: null });
    });
  });

  describe('backup codes', () => {
    it('work once, also under concurrency, and report how many are left', async () => {
      const userId = await newUser();
      const hashes = await enroll(userId);
      expect(await scalar(userId, 'auth_use_backup_code($1)', [hashes[0]])).toBe(9);
      expect(await scalar(userId, 'auth_use_backup_code($1)', [hashes[0]])).toBeNull();
      const results = await Promise.all(Array.from({ length: 4 }, () => scalar<number | null>(userId, 'auth_use_backup_code($1)', [hashes[1]])));
      expect(results.filter((left) => left !== null)).toEqual([8]);
    });

    it('an unknown code or one of another user is refused', async () => {
      const [first, second] = [await newUser(), await newUser()];
      const hashes = await enroll(first);
      await enroll(second);
      expect(await scalar(second, 'auth_use_backup_code($1)', [hashes[0]])).toBeNull();
      expect(await scalar(first, 'auth_use_backup_code($1)', [hash('unknown')])).toBeNull();
    });

    it('are replaced as a whole: the old ones stop working', async () => {
      const userId = await newUser();
      const old = await enroll(userId);
      const fresh = tenHashes();
      await asUser(userId, (client) => client.query('SELECT auth_replace_backup_codes($1)', [fresh]));
      expect(await scalar(userId, 'auth_use_backup_code($1)', [old[0]])).toBeNull();
      expect(await scalar(userId, 'auth_use_backup_code($1)', [fresh[0]])).toBe(9);
    });

    it('cannot be used or replaced while MFA is off', async () => {
      const userId = await newUser();
      expect(await scalar(userId, 'auth_use_backup_code($1)', [hash('x')])).toBeNull();
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('SELECT auth_replace_backup_codes($1)', [tenHashes()])))).toBe(SqlState.checkViolation);
    });
  });

  describe('disabling', () => {
    it('clears everything, revokes the other sessions and un-verifies the kept one', async () => {
      const userId = await newUser();
      const [keep, other] = [await addSession(userId), await addSession(userId)];
      await enroll(userId, tenHashes(), keep);
      await asUser(userId, (client) => client.query('SELECT auth_disable_mfa($1)', [keep]));

      const user = (await db.owner.query('SELECT mfa_enabled, mfa_secret_encrypted, mfa_last_step, mfa_enabled_at FROM users WHERE id = $1', [userId])).rows[0];
      expect(user).toEqual({ mfa_enabled: false, mfa_secret_encrypted: null, mfa_last_step: null, mfa_enabled_at: null });
      expect((await db.owner.query('SELECT 1 FROM user_mfa_backup_codes WHERE user_id = $1', [userId])).rowCount).toBe(0);
      const sessions = Object.fromEntries((await sessionsOf(userId)).map((row) => [row.id, row]));
      expect(sessions[keep]).toMatchObject({ revoked: false, mfa_verified: false });
      expect(sessions[other]).toMatchObject({ revoked: true });
    });

    it('is refused for a member of a tenant that requires MFA, and for a platform administrator', async () => {
      const member = await newUser();
      await enroll(member);
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]);
      try {
        expect(await sqlStateOf(() => asUser(member, (client) => client.query('SELECT auth_disable_mfa(NULL)')))).toBe(SqlState.checkViolation);
      } finally {
        await db.owner.query('UPDATE tenants SET mfa_required = false WHERE id = $1', [tenant.tenantId]);
      }
      await asUser(member, (client) => client.query('SELECT auth_disable_mfa(NULL)'));

      const admin = await newUser();
      await enroll(admin);
      await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [admin]);
      expect(await sqlStateOf(() => asUser(admin, (client) => client.query('SELECT auth_disable_mfa(NULL)')))).toBe(SqlState.checkViolation);
    });

    it('is refused when MFA is not on', async () => {
      const userId = await newUser();
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('SELECT auth_disable_mfa(NULL)')))).toBe(SqlState.checkViolation);
    });
  });

  describe('key rotation (auth_reencrypt_mfa_secret)', () => {
    it('swaps the secret only if it is still the one that was read', async () => {
      const userId = await newUser();
      await enroll(userId);
      expect(await scalar(userId, 'auth_reencrypt_mfa_secret($1, $2)', [Buffer.from('ciphertext'), Buffer.from('rotated')])).toBe(true);
      expect(await scalar(userId, 'auth_reencrypt_mfa_secret($1, $2)', [Buffer.from('ciphertext'), Buffer.from('again')])).toBe(false);
    });
  });

  describe('memberships and policy', () => {
    it('auth_list_memberships tells which organizations require MFA', async () => {
      const userId = await newUser();
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]);
      try {
        const rows = await asUser(userId, async (client) => (await client.query<{ tenant_mfa_required: boolean }>('SELECT * FROM auth_list_memberships($1)', [userId])).rows);
        expect(rows.map((row) => row.tenant_mfa_required)).toEqual([true]);
        expect(await scalar(userId, 'auth_mfa_required_by_membership($1)', [userId])).toBe(true);
      } finally {
        await db.owner.query('UPDATE tenants SET mfa_required = false WHERE id = $1', [tenant.tenantId]);
      }
      expect(await scalar(userId, 'auth_mfa_required_by_membership($1)', [userId])).toBe(false);
    });

    it('a tenant policy never reaches the members of another tenant', async () => {
      const other = await seedTenant(db.platform);
      const outsider = await seedMember(db.platform, other);
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]);
      try {
        expect(await scalar(outsider, 'auth_mfa_required_by_membership($1)', [outsider])).toBe(false);
      } finally {
        await db.owner.query('UPDATE tenants SET mfa_required = false WHERE id = $1', [tenant.tenantId]);
      }
    });

    it('a tenant session can change its own policy and nobody else’s', async () => {
      const other = await seedTenant(db.platform);
      const admin = tenant.userId;
      await withContext(db.runtime, { tenantId: tenant.tenantId, userId: admin }, (client) => client.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]));
      const touched = await withContext(db.runtime, { tenantId: tenant.tenantId, userId: admin }, (client) => client.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [other.tenantId]));
      expect(touched.rowCount).toBe(0);
      await db.owner.query('UPDATE tenants SET mfa_required = false WHERE id = ANY($1)', [[tenant.tenantId, other.tenantId]]);
    });
  });

  describe('privileges', () => {
    it('the application cannot read the new user columns nor the backup codes, nor write mfa_verified afterwards', async () => {
      const userId = await newUser();
      for (const column of ['mfa_last_step', 'mfa_failed_attempts', 'mfa_locked_until', 'mfa_enabled_at', 'password_changed_at']) {
        expect(await sqlStateOf(() => asUser(userId, (client) => client.query(`SELECT ${column} FROM users`))), column).toBe(SqlState.insufficientPrivilege);
      }
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('SELECT * FROM user_mfa_backup_codes')))).toBe(SqlState.insufficientPrivilege);
      const sessionId = await addSession(userId);
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('UPDATE refresh_sessions SET mfa_verified = true WHERE id = $1', [sessionId])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => asUser(userId, (client) => client.query('UPDATE users SET mfa_enabled = false WHERE id = $1', [userId])))).toBe(SqlState.insufficientPrivilege);
    });

    it('the previous generic functions are gone', async () => {
      const { rows } = await db.owner.query<{ proname: string }>(`SELECT proname FROM pg_proc WHERE proname IN ('auth_set_own_mfa', 'auth_get_own_mfa_secret', 'auth_register_login_attempt', 'auth_set_own_password')`);
      expect(rows).toEqual([]);
    });
  });
});
