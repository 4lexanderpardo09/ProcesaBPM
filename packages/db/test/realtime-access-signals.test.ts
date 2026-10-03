import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { connectTestDatabase, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

const CHANNEL = 'procesabpm_realtime';
const SIGNAL_KEYS = new Set(['v', 'k', 's', 't', 'u', 'r']);

describe('realtime access signals (triggers)', () => {
  let db: TestDatabase;
  let listener: pg.Client;
  let tenant: SeededTenant;
  let memberId: string;
  const received: Array<Record<string, unknown>> = [];

  const newSession = (userId: string, tenantId: string | null = tenant.tenantId) =>
    insertReturningId(db.owner, `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`, [userId, tenantId, randomUUID()]);

  /** Waits for the signals of the statements run by `work`, then returns what arrived. */
  const signalsOf = async (work: () => Promise<unknown>): Promise<Array<Record<string, unknown>>> => {
    await flush();
    received.length = 0;
    await work();
    await flush();
    return [...received];
  };
  /** A signal sent on another connection arrives before the one sent after it: wait for a marker. */
  const flush = async () => {
    const marker = randomUUID();
    await db.owner.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ v: 1, k: 'marker', m: marker })]);
    for (let waited = 0; !received.some((signal) => signal.m === marker) && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    const index = received.findIndex((signal) => signal.m === marker);
    if (index >= 0) received.splice(index, 1);
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    listener = new pg.Client({ connectionString: inject('ownerUrl') });
    await listener.connect();
    listener.on('notification', (message) => received.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
    await listener.query(`LISTEN ${CHANNEL}`);
    tenant = await seedTenant(db.platform);
    memberId = await seedMember(db.platform, tenant);
    await flush();
  });

  afterAll(async () => {
    await listener.end();
    await db.close();
  });

  it('signals a real revocation of a session with exactly its id', async () => {
    const sessionId = await newSession(memberId);
    const signals = await signalsOf(() => db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [sessionId]));
    expect(signals).toEqual([{ v: 1, k: 'access', s: sessionId }]);
  });

  it('does not signal a rotation (revoked_at and replaced_by in the same update), a second revocation or a rollback', async () => {
    const [old, next, other] = [await newSession(memberId), await newSession(memberId), await newSession(memberId)];
    expect(await signalsOf(() => db.platform.query('UPDATE refresh_sessions SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [old, next]))).toEqual([]);
    await db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [other]);
    expect(await signalsOf(() => db.platform.query('UPDATE refresh_sessions SET revoked_at = now() + interval \'1 second\' WHERE id = $1', [other]))).toEqual([]);
    const live = await newSession(memberId);
    const client = await db.platform.connect();
    try {
      expect(
        await signalsOf(async () => {
          await client.query('BEGIN');
          await client.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [live]);
          await client.query('ROLLBACK');
        }),
      ).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('does not signal updates that do not touch access (last use, same values)', async () => {
    const sessionId = await newSession(memberId);
    expect(await signalsOf(() => db.platform.query(`UPDATE refresh_sessions SET user_agent = 'x' WHERE id = $1`, [sessionId]))).toEqual([]);
    expect(await signalsOf(() => db.platform.query('UPDATE users SET last_login_at = now() WHERE id = $1', [memberId]))).toEqual([]);
    expect(await signalsOf(() => db.platform.query('UPDATE users SET password_changed_at = password_changed_at WHERE id = $1', [memberId]))).toEqual([]);
  });

  it('signals a membership change with the tenant and the user', async () => {
    const otherRole = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, 'Other') RETURNING id`, [tenant.tenantId]);
    const signals = await signalsOf(() => db.platform.query('UPDATE memberships SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, memberId, otherRole]));
    expect(signals).toEqual([{ v: 1, k: 'access', t: tenant.tenantId, u: memberId }]);
    const status = await signalsOf(() => db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, memberId]));
    expect(status).toEqual([{ v: 1, k: 'access', t: tenant.tenantId, u: memberId }]);
  });

  it('signals a role change once per permission change (role_permissions bumps the version)', async () => {
    const role = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, 'Changing') RETURNING id`, [tenant.tenantId]);
    const permissionId = (await db.owner.query<{ id: string }>(`SELECT id FROM permissions WHERE subject = 'Company' LIMIT 1`)).rows[0]!.id;
    const signals = await signalsOf(() => db.platform.query('INSERT INTO role_permissions (tenant_id, role_id, permission_id) VALUES ($1, $2, $3)', [tenant.tenantId, role, permissionId]));
    expect(signals).toEqual([{ v: 1, k: 'access', t: tenant.tenantId, r: role }]);
    const deactivated = await signalsOf(() => db.platform.query('UPDATE roles SET is_active = false WHERE id = $1', [role]));
    expect(deactivated).toEqual([{ v: 1, k: 'access', t: tenant.tenantId, r: role }]);
    expect(await signalsOf(() => db.platform.query(`UPDATE roles SET name = 'Renamed' WHERE id = $1`, [role]))).toEqual([]);
  });

  it('signals tenant status and MFA policy changes with the tenant only', async () => {
    const signals = await signalsOf(() => db.platform.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [tenant.tenantId]));
    expect(signals).toEqual([{ v: 1, k: 'access', t: tenant.tenantId }]);
    expect(await signalsOf(() => db.platform.query(`UPDATE tenants SET name = 'Renamed tenant' WHERE id = $1`, [tenant.tenantId]))).toEqual([]);
  });

  it('signals a password change and an account status change with the user only', async () => {
    const signals = await signalsOf(() => db.platform.query('UPDATE users SET password_changed_at = now() WHERE id = $1', [memberId]));
    expect(signals).toEqual([{ v: 1, k: 'access', u: memberId }]);
    const status = await signalsOf(() => db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [memberId]));
    expect(status).toEqual([{ v: 1, k: 'access', u: memberId }]);
  });

  it('only ever carries ids from the whitelisted keys', async () => {
    const sessionId = await newSession(memberId);
    const signals = await signalsOf(async () => {
      await db.platform.query('UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
      await db.platform.query('UPDATE tenants SET mfa_required = false WHERE id = $1', [tenant.tenantId]);
      await db.platform.query('UPDATE users SET password_changed_at = now() WHERE id = $1', [memberId]);
    });
    expect(signals.length).toBe(3);
    for (const signal of signals) expect(Object.keys(signal).every((key) => SIGNAL_KEYS.has(key))).toBe(true);
  });

  it('is not executable by the application roles', async () => {
    const { rows } = await db.owner.query<{ role: string; allowed: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'trg_realtime_access_signal()', 'EXECUTE') AS allowed FROM unnest(ARRAY['app_runtime', 'app_worker', 'app_platform']) AS r`,
    );
    expect(rows.filter((row) => row.allowed)).toEqual([]);
  });
});
