import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('support access', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let adminId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenantA = await seedTenant(db.platform);
    tenantB = await seedTenant(db.platform);
    adminId = await newPlatformAdmin();
  });
  afterAll(() => db.close());

  async function newPlatformAdmin(): Promise<string> {
    const id = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Sup', 'Port') RETURNING id`, [`support-${randomUUID()}@example.com`]);
    await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [id]);
    return id;
  }
  /** Creates a grant for the tenant the way the API does: as the tenant's member, in its context. */
  const grant = (tenant: SeededTenant, options: { startsAt?: string; expiresAt?: string; reason?: string } = {}) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, async (client) =>
      (await client.query<{ id: string }>(
        `INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, starts_at, expires_at)
         VALUES ($1, $2, $3, coalesce($4::timestamptz, now()), coalesce($5::timestamptz, now() + interval '24 hours')) RETURNING id`,
        [tenant.tenantId, tenant.userId, options.reason ?? 'Investigating a stuck ticket', options.startsAt ?? null, options.expiresAt ?? null],
      )).rows[0]!.id);
  const revoke = (tenant: SeededTenant, grantId: string) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
      client.query(`UPDATE support_access_grants SET revoked_at = now(), revoked_by_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, grantId, tenant.userId]));
  const open = (tenantId: string, admin = adminId) =>
    withoutContext(db.platform, async (client) =>
      (await client.query<{ out_grant_id: string; out_session_id: string; out_expires_at: Date }>('SELECT * FROM platform_open_support_session($1, $2)', [tenantId, admin])).rows);
  const verify = (tenantId: string, sessionId: string, grantId: string, admin = adminId) =>
    withContext(db.runtime, { tenantId, userId: admin }, async (client) =>
      (await client.query<{ ok: boolean }>('SELECT auth_verify_support_session($1, $2, $3, $4) AS ok', [tenantId, sessionId, grantId, admin])).rows[0]!.ok);
  const closedAt = async (tenantId: string, sessionId: string) =>
    (await db.owner.query<{ closed_at: Date | null }>('SELECT closed_at FROM support_sessions WHERE tenant_id = $1 AND id = $2', [tenantId, sessionId])).rows[0]!.closed_at;

  async function freshTenant(): Promise<SeededTenant> {
    return seedTenant(db.platform);
  }

  describe('the grant', () => {
    it('lasts at most 72 hours and needs a real window and a reason', async () => {
      const tenant = await freshTenant();
      expect(await sqlStateOf(() => grant(tenant, { expiresAt: new Date(Date.now() + 73 * 3_600_000).toISOString() }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => grant(tenant, { startsAt: new Date(Date.now() + 3_600_000).toISOString(), expiresAt: new Date(Date.now() + 1_800_000).toISOString() }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => grant(tenant, { reason: 'x' }))).toBe(SqlState.checkViolation);
      await grant(tenant, { expiresAt: new Date(Date.now() + 71 * 3_600_000).toISOString() });
    });

    it('allows one grant in force per tenant until it is revoked', async () => {
      const tenant = await freshTenant();
      const first = await grant(tenant);
      expect(await sqlStateOf(() => grant(tenant))).toBe(SqlState.uniqueViolation);
      await revoke(tenant, first);
      await grant(tenant);
    });

    it('belongs to its tenant: another tenant neither sees nor creates it', async () => {
      const tenant = await freshTenant();
      await grant(tenant);
      const seen = await withContext(db.runtime, { tenantId: tenantB.tenantId, userId: tenantB.userId }, (c) => c.query('SELECT 1 FROM support_access_grants WHERE tenant_id = $1', [tenant.tenantId]));
      expect(seen.rowCount).toBe(0);
      expect(await sqlStateOf(() => withContext(db.runtime, { tenantId: tenantB.tenantId, userId: tenantB.userId }, (c) =>
        c.query(`INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, expires_at) VALUES ($1, $2, 'sneaky grant', now() + interval '1 hour')`, [tenant.tenantId, tenant.userId])))).toBe(SqlState.insufficientPrivilege);
    });

    it('can only be revoked, never edited or deleted, by the application', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      const as = <T>(work: (c: import('pg').PoolClient) => Promise<T>) => withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, work);
      expect(await sqlStateOf(() => as((c) => c.query(`UPDATE support_access_grants SET expires_at = expires_at + interval '1 hour' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => as((c) => c.query(`UPDATE support_access_grants SET reason = 'edited' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => as((c) => c.query(`DELETE FROM support_access_grants WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id])))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => withoutContext(db.platform, (c) => c.query(`UPDATE support_access_grants SET reason = 'edited' WHERE tenant_id = $1`, [tenant.tenantId])))).toBe(SqlState.insufficientPrivilege);
    });

    it('the revoker must be a member and needs a revocation date', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE support_access_grants SET revoked_by_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id, tenant.userId]))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE support_access_grants SET revoked_at = now(), revoked_by_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id, adminId]))).toBe(SqlState.foreignKeyViolation);
    });
  });

  describe('history is final', () => {
    it('a visit is closed once, and nothing else about it changes', async () => {
      const tenant = await freshTenant();
      await grant(tenant);
      const [row] = await open(tenant.tenantId);
      const update = (sql: string) => db.owner.query(`UPDATE support_sessions SET ${sql} WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, row!.out_session_id]);
      expect(await sqlStateOf(() => update(`platform_user_label = 'Someone Else'`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => update(`opened_at = now() - interval '1 day'`))).toBe(SqlState.checkViolation);
      await update('closed_at = now()');
      expect(await sqlStateOf(() => update(`closed_at = NULL`))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => update(`closed_at = now() + interval '1 day'`))).toBe(SqlState.checkViolation);
    });

    it('a revoked grant cannot be un-revoked or re-attributed', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      await revoke(tenant, id);
      const update = (sql: string) => db.owner.query(`UPDATE support_access_grants SET ${sql} WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
      expect(await sqlStateOf(() => update('revoked_at = NULL, revoked_by_id = NULL'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => update(`revoked_at = now() + interval '1 day'`))).toBe(SqlState.checkViolation);
    });
  });

  describe('opening a visit', () => {
    it('returns nothing without a grant, and a visit under a grant in force', async () => {
      const tenant = await freshTenant();
      expect(await open(tenant.tenantId)).toEqual([]);
      const id = await grant(tenant);
      const [row] = await open(tenant.tenantId);
      expect(row).toMatchObject({ out_grant_id: id, out_session_id: expect.any(String), out_expires_at: expect.any(Date) });
      expect(await closedAt(tenant.tenantId, row!.out_session_id)).toBeNull();
      const label = await db.owner.query('SELECT platform_user_label FROM support_sessions WHERE id = $1', [row!.out_session_id]);
      expect(label.rows).toEqual([{ platform_user_label: 'Sup Port' }]);
    });

    it('the grant of one tenant opens nothing in another', async () => {
      const a = await freshTenant();
      const b = await freshTenant();
      await grant(a);
      expect(await open(b.tenantId)).toEqual([]);
    });

    it('returns nothing once the grant was revoked or has expired', async () => {
      const revoked = await freshTenant();
      await revoke(revoked, await grant(revoked));
      expect(await open(revoked.tenantId)).toEqual([]);

      const expired = await freshTenant();
      await grant(expired, { startsAt: new Date(Date.now() - 7_200_000).toISOString(), expiresAt: new Date(Date.now() - 3_600_000).toISOString() });
      expect(await open(expired.tenantId)).toEqual([]);
    });

    it('works for a suspended tenant and not for a deleted one', async () => {
      const suspended = await freshTenant();
      await grant(suspended);
      await db.owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [suspended.tenantId]);
      expect(await open(suspended.tenantId)).toHaveLength(1);
      await db.owner.query(`UPDATE tenants SET status = 'CANCELLED' WHERE id = $1`, [suspended.tenantId]);
      expect(await open(suspended.tenantId)).toEqual([]);
    });

    it('refuses someone who is not an active platform admin (member, disabled admin)', async () => {
      const tenant = await freshTenant();
      await grant(tenant);
      expect(await sqlStateOf(() => open(tenant.tenantId, tenant.userId))).toBe(SqlState.insufficientPrivilege);
      const disabled = await newPlatformAdmin();
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled]);
      expect(await sqlStateOf(() => open(tenant.tenantId, disabled))).toBe(SqlState.insufficientPrivilege);
    });

    it('is closed to the API and worker logins', async () => {
      const tenant = await freshTenant();
      await grant(tenant);
      for (const pool of [db.runtime, db.worker]) {
        expect(await sqlStateOf(() => withoutContext(pool, (c) => c.query('SELECT * FROM platform_open_support_session($1, $2)', [tenant.tenantId, adminId])))).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('the API cannot insert a visit by hand', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      expect(await sqlStateOf(() => withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (c) =>
        c.query(`INSERT INTO support_sessions (tenant_id, grant_id, platform_user_id, platform_user_label) VALUES ($1, $2, $3, 'x')`, [tenant.tenantId, id, adminId])))).toBe(SqlState.insufficientPrivilege);
    });

    it('many simultaneous openings all get their own visit', async () => {
      const tenant = await freshTenant();
      await grant(tenant);
      const rows = await Promise.all(Array.from({ length: 5 }, () => open(tenant.tenantId)));
      expect(new Set(rows.map(([row]) => row!.out_session_id)).size).toBe(5);
    });
  });

  describe('checking a visit on every request', () => {
    it('is valid while the grant is in force', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      const [row] = await open(tenant.tenantId);
      expect(await verify(tenant.tenantId, row!.out_session_id, id)).toBe(true);
    });

    it('turns false and closes the visit as soon as the grant is revoked', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      const [row] = await open(tenant.tenantId);
      await revoke(tenant, id);
      expect(await verify(tenant.tenantId, row!.out_session_id, id)).toBe(false);
      expect(await closedAt(tenant.tenantId, row!.out_session_id)).not.toBeNull();
    });

    it('turns false when the grant expires', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant, { startsAt: new Date(Date.now() - 3_600_000).toISOString(), expiresAt: new Date(Date.now() + 2_000).toISOString() });
      const [row] = await open(tenant.tenantId);
      expect(await verify(tenant.tenantId, row!.out_session_id, id)).toBe(true);
      await db.owner.query(`UPDATE support_access_grants SET starts_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id]);
      expect(await verify(tenant.tenantId, row!.out_session_id, id)).toBe(false);
    });

    it('does not accept another admin, grant, tenant or an unknown visit', async () => {
      const tenant = await freshTenant();
      const other = await freshTenant();
      const id = await grant(tenant);
      await grant(other);
      const [row] = await open(tenant.tenantId);
      expect(await verify(tenant.tenantId, row!.out_session_id, id, await newPlatformAdmin())).toBe(false);
      expect(await verify(tenant.tenantId, row!.out_session_id, randomUUID())).toBe(false);
      expect(await verify(other.tenantId, row!.out_session_id, id)).toBe(false);
      expect(await verify(tenant.tenantId, randomUUID(), id)).toBe(false);
    });

    it('turns false when the admin is removed or disabled', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      const removed = await newPlatformAdmin();
      const [row] = await open(tenant.tenantId, removed);
      await db.owner.query('DELETE FROM platform_admins WHERE user_id = $1', [removed]);
      expect(await verify(tenant.tenantId, row!.out_session_id, id, removed)).toBe(false);
    });
  });

  describe('audit rows of a visit', () => {
    const insertAudit = (tenant: SeededTenant, columns: { actorId?: string | null; supportActorId?: string | null; supportGrantId?: string | null }) =>
      withContext(db.runtime, { tenantId: tenant.tenantId, userId: columns.actorId ?? tenant.userId }, (c) =>
        c.query(
          `INSERT INTO audit_logs (tenant_id, actor_id, support_actor_id, support_grant_id, action, entity_type) VALUES ($1, $2, $3, $4, 'support.request', 'SupportRequest')`,
          [tenant.tenantId, columns.actorId ?? null, columns.supportActorId ?? null, columns.supportGrantId ?? null],
        ));

    it('record the admin and the grant, with no member as actor', async () => {
      const tenant = await freshTenant();
      const id = await grant(tenant);
      await insertAudit(tenant, { supportActorId: adminId, supportGrantId: id });
      const { rows } = await db.owner.query('SELECT actor_id, support_actor_id, support_grant_id FROM audit_logs WHERE tenant_id = $1 AND support_grant_id = $2', [tenant.tenantId, id]);
      expect(rows).toEqual([{ actor_id: null, support_actor_id: adminId, support_grant_id: id }]);
    });

    it('need both columns, no member actor, and a grant of the same tenant', async () => {
      const tenant = await freshTenant();
      const other = await freshTenant();
      const id = await grant(tenant);
      const foreign = await grant(other);
      expect(await sqlStateOf(() => insertAudit(tenant, { supportActorId: adminId }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => insertAudit(tenant, { supportGrantId: id }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => insertAudit(tenant, { actorId: tenant.userId, supportActorId: adminId, supportGrantId: id }))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => insertAudit(tenant, { supportActorId: adminId, supportGrantId: foreign }))).toBe(SqlState.foreignKeyViolation);
    });
  });

  it('the grantor must be a member of the tenant', async () => {
    const tenant = await freshTenant();
    const outsider = await seedMember(db.platform, tenantB);
    expect(await sqlStateOf(() => db.owner.query(`INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, expires_at) VALUES ($1, $2, 'not a member', now() + interval '1 hour')`, [tenant.tenantId, outsider]))).toBe(SqlState.foreignKeyViolation);
  });
});
