import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlatformAdmin, PLATFORM_ADMIN_BOOTSTRAP_ACTION, PlatformAdminAlreadyExistsError, PlatformLoginRequiredError } from '../src/seed/platform-admin.js';
import { connectTestDatabase, type TestDatabase } from './support/database.js';

const WEB = 'https://app.example.com';
const input = (email: string, forceAdditional = false) => ({ email, firstName: 'Ada', lastName: 'Root', forceAdditional, webBaseUrl: WEB });

describe('create-platform-admin command', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });
  afterAll(() => db.close());
  beforeEach(async () => {
    await db.owner.query('DELETE FROM platform_admins');
  });

  const run = async (email: string, forceAdditional = false) => {
    const client = await db.platform.connect();
    try {
      return await createPlatformAdmin(client, input(email, forceAdditional));
    } finally {
      client.release();
    }
  };
  const adminCount = async () => Number((await db.owner.query<{ n: string }>('SELECT count(*) AS n FROM platform_admins')).rows[0]!.n);

  it('creates the user and the admin, with a link that expires in 24 hours and only its hash stored', async () => {
    const email = `root-${Date.now()}@example.com`;
    const admin = await run(email.toUpperCase());

    expect(admin.email).toBe(email);
    const url = new URL(admin.setPasswordLink!);
    expect(`${url.origin}${url.pathname}`).toBe(`${WEB}/reset-password`);
    const token = decodeURIComponent(url.hash.replace('#token=', ''));
    const hash = createHash('sha256').update(token).digest('hex');
    const stored = await db.owner.query<{ type: string; hours: number }>(
      `SELECT type, (extract(epoch FROM expires_at - now()) / 3600)::float8 AS hours FROM user_tokens WHERE token_hash = $1 AND user_id = $2`,
      [hash, admin.userId],
    );
    expect(stored.rows[0]!.type).toBe('PASSWORD_RESET');
    expect(stored.rows[0]!.hours).toBeGreaterThan(23.9);
    expect(stored.rows[0]!.hours).toBeLessThanOrEqual(24);
    expect(await adminCount()).toBe(1);
    const user = await db.owner.query<{ password_hash: string | null; mfa_enabled: boolean }>('SELECT password_hash, mfa_enabled FROM users WHERE id = $1', [admin.userId]);
    expect(user.rows[0]).toEqual({ password_hash: null, mfa_enabled: false });
  });

  it('is recorded in the platform audit log', async () => {
    const admin = await run(`audit-${Date.now()}@example.com`);
    const log = await db.owner.query<{ action: string; data: { via: string } }>('SELECT action, data FROM platform_audit_logs WHERE actor_user_id = $1', [admin.userId]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]!.action).toBe(PLATFORM_ADMIN_BOOTSTRAP_ACTION);
    expect(log.rows[0]!.data.via).toBe('cli');
  });

  it('can be repeated for the only admin while no password is set, issuing a fresh link', async () => {
    const email = `again-${Date.now()}@example.com`;
    const first = await run(email);
    const second = await run(email);

    expect(second.userId).toBe(first.userId);
    expect(second.setPasswordLink).not.toBe(first.setPasswordLink);
    expect(await adminCount()).toBe(1);
  });

  it('refuses when another admin exists, unless --force-additional is given', async () => {
    await run(`first-${Date.now()}@example.com`);
    const other = `second-${Date.now()}@example.com`;

    await expect(run(other)).rejects.toBeInstanceOf(PlatformAdminAlreadyExistsError);
    expect(await adminCount()).toBe(1);
    expect(await db.owner.query('SELECT 1 FROM users WHERE email = $1', [other])).toHaveProperty('rowCount', 0);

    await run(other, true);
    expect(await adminCount()).toBe(2);
  });

  it('refuses for an admin who already chose a password', async () => {
    const email = `done-${Date.now()}@example.com`;
    const admin = await run(email);
    await db.owner.query(`UPDATE users SET password_hash = 'x' WHERE id = $1`, [admin.userId]);

    await expect(run(email)).rejects.toBeInstanceOf(PlatformAdminAlreadyExistsError);
  });

  it('promotes an existing user with a password without a link and without consuming their pending tokens', async () => {
    const email = `member-${Date.now()}@example.com`;
    const { rows } = await db.owner.query<{ id: string }>(`INSERT INTO users (email, first_name, last_name, password_hash) VALUES ($1, 'Mem', 'Ber', 'existing-hash') RETURNING id`, [email]);
    await db.owner.query(`INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'PASSWORD_RESET', 'pending-hash', now() + interval '1 hour')`, [rows[0]!.id]);

    const admin = await run(email, true);

    expect(admin.setPasswordLink).toBeNull();
    expect(admin.expiresAt).toBeNull();
    const tokens = await db.owner.query<{ consumed_at: Date | null }>('SELECT consumed_at FROM user_tokens WHERE user_id = $1', [admin.userId]);
    expect(tokens.rows).toEqual([{ consumed_at: null }]);

    const user = await db.owner.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [admin.userId]);
    expect(user.rows[0]!.password_hash).toBe('existing-hash');
    expect(await adminCount()).toBe(1);
  });

  it('refuses to run with the schema owner or any superuser, and creates nothing', async () => {
    const email = `owner-run-${Date.now()}@example.com`;
    const client = await db.owner.connect();
    try {
      await expect(createPlatformAdmin(client, input(email))).rejects.toBeInstanceOf(PlatformLoginRequiredError);
    } finally {
      client.release();
    }
    expect(await db.owner.query('SELECT 1 FROM users WHERE email = $1', [email])).toHaveProperty('rowCount', 0);
  });

  it('refuses a login that is not a member of app_platform', async () => {
    const client = await db.runtime.connect();
    try {
      await expect(createPlatformAdmin(client, input(`runtime-run-${Date.now()}@example.com`))).rejects.toBeInstanceOf(PlatformLoginRequiredError);
    } finally {
      client.release();
    }
  });
});
