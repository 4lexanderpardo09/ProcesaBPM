import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, withPlatformTransaction, type SeededTenant } from './support/fixtures.js';

const INVALID_PARAMETER_VALUE = '22023';
const REASON = 'Lost the phone and the backup codes';
const REFERENCE = 'CASE-1234';

interface ResetInput {
  readonly admin?: string;
  readonly user: string;
  readonly reason?: string;
  readonly method?: string;
  readonly reference?: string;
  readonly tenantAdmin?: string | null;
}

interface ResetRow {
  out_reset_at: Date;
  out_revoked_sessions: number;
  out_audit_id: string;
}

/** The smallest valid second factor (the CHECK wants the secret and the date with it). */
const ENABLE_MFA = `UPDATE users SET mfa_enabled = true, mfa_enabled_at = now(), mfa_secret_encrypted = '\\x01' WHERE id = $1`;

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('platform MFA reset', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let adminId: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    // The seeded administrators own their tenants, so they get the owners' notice.
    for (const tenant of [tenantA, tenantB]) {
      await db.platform.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
    }
    adminId = await newPlatformAdmin();
  });

  afterAll(async () => {
    await db.close();
  });

  async function newPlatformAdmin(): Promise<string> {
    const id = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Sup', 'Port') RETURNING id`, [`mfa-reset-${randomUUID()}@example.com`]);
    await db.platform.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [id]);
    return id;
  }

  /** An ACTIVE member of `tenant` with MFA on, three backup codes and a password lockout in progress. */
  async function memberWithMfa(tenant: SeededTenant): Promise<string> {
    const userId = await seedMember(db.platform, tenant);
    await db.owner.query(
      `UPDATE users SET password_hash = 'hash', mfa_enabled = true, mfa_enabled_at = now(), mfa_secret_encrypted = '\\x01', mfa_last_step = 42,
                        mfa_failed_attempts = 3, mfa_locked_until = now() + interval '5 minutes', failed_logins = 2, locked_until = now() + interval '5 minutes'
       WHERE id = $1`,
      [userId],
    );
    for (let index = 0; index < 3; index += 1) await db.owner.query('INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hash()]);
    return userId;
  }

  async function addMembership(tenant: SeededTenant, userId: string, status = 'ACTIVE', roleId = tenant.roleId): Promise<void> {
    await withPlatformTransaction(db.platform, async (tx) => {
      await tx.query('INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, $4::membership_status)', [tenant.tenantId, userId, roleId, status]);
      await tx.query('INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)', [tenant.tenantId, userId, tenant.companyId]);
    });
  }

  const reset = (input: ResetInput, pool = db.platform) =>
    withContext(pool, {}, async (client) => {
      const { rows } = await client.query<ResetRow>('SELECT * FROM platform_reset_user_mfa($1, $2, $3, $4, $5, $6, $7)', [
        input.admin ?? adminId,
        input.user,
        input.reason ?? REASON,
        input.method ?? 'VIDEO_CALL',
        input.reference ?? REFERENCE,
        input.tenantAdmin ?? null,
        '203.0.113.9',
      ]);
      return rows;
    });

  const userState = async (userId: string) =>
    (
      await db.owner.query(
        `SELECT mfa_enabled, mfa_enabled_at, mfa_secret_encrypted, mfa_last_step, mfa_failed_attempts, mfa_locked_until, failed_logins, locked_until,
                mfa_reset_at IS NOT NULL AS was_reset, password_hash, (SELECT count(*)::int FROM user_mfa_backup_codes c WHERE c.user_id = u.id) AS backup_codes
         FROM users u WHERE id = $1`,
        [userId],
      )
    ).rows[0];
  const noticesFor = async (userId: string) =>
    (
      await db.owner.query<{ payload: Record<string, string> }>(
        `SELECT payload FROM platform_outbox_events WHERE type = 'email.security_notice' AND (payload ->> 'userId' = $1 OR payload ->> 'memberId' = $1) ORDER BY payload ->> 'userId'`,
        [userId],
      )
    ).rows.map((row) => row.payload);
  const tenantAuditRows = async (userId: string) =>
    (
      await db.owner.query<{ tenant_id: string; actor_id: string | null; entity_type: string; after: Record<string, string>; ip_address: string }>(
        `SELECT tenant_id, actor_id, entity_type, after, ip_address FROM audit_logs WHERE action = 'account.mfa_reset_by_support' AND entity_id = $1 ORDER BY tenant_id`,
        [userId],
      )
    ).rows;
  const platformAuditRows = async (userId: string) =>
    (
      await db.owner.query<{ id: string; actor_user_id: string; data: Record<string, unknown>; ip_address: string }>(
        `SELECT id, actor_user_id, data, ip_address FROM platform_audit_logs WHERE action = 'user.mfa_reset' AND data ->> 'userId' = $1`,
        [userId],
      )
    ).rows;
  const insertSession = (userId: string, activeTenantId: string | null, expiresIn = `interval '1 day'`) =>
    insertReturningId(db.owner, `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + ${expiresIn}) RETURNING id`, [
      userId,
      activeTenantId,
      hash(),
    ]);
  const openSessions = async (userId: string) =>
    (await db.owner.query<{ id: string }>('SELECT id FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY id', [userId])).rows.map((row) => row.id);

  describe('effect', () => {
    it('clears the factor, the backup codes and the lockouts, and leaves the password alone', async () => {
      const userId = await memberWithMfa(tenantA);
      const [row] = await reset({ user: userId });
      expect(row).toEqual({ out_reset_at: expect.any(Date), out_revoked_sessions: 0, out_audit_id: expect.any(String) });
      expect(await userState(userId)).toEqual({
        mfa_enabled: false,
        mfa_enabled_at: null,
        mfa_secret_encrypted: null,
        mfa_last_step: null,
        mfa_failed_attempts: 0,
        mfa_locked_until: null,
        failed_logins: 0,
        locked_until: null,
        was_reset: true,
        password_hash: 'hash',
        backup_codes: 0,
      });
    });

    it('revokes every live session of the user, tenant and platform, and closes the support visits they opened', async () => {
      const userId = await memberWithMfa(tenantA);
      await db.platform.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [userId]);
      const tenantSession = await insertSession(userId, tenantA.tenantId);
      const platformSession = await insertSession(userId, null);
      const expired = await insertSession(userId, null, `- interval '1 minute'`);
      const grantId = await insertReturningId(
        db.owner,
        `INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, starts_at, expires_at) VALUES ($1, $2, 'Investigating', now(), now() + interval '1 hour') RETURNING id`,
        [tenantB.tenantId, tenantB.userId],
      );
      const visit = await insertReturningId(
        db.owner,
        `INSERT INTO support_sessions (tenant_id, grant_id, platform_user_id, platform_user_label, platform_session_id) VALUES ($1, $2, $3, 'Test User', $4) RETURNING id`,
        [tenantB.tenantId, grantId, userId, platformSession],
      );
      const othersSession = await insertSession(tenantA.userId, tenantA.tenantId);

      const [row] = await reset({ user: userId });

      expect(row?.out_revoked_sessions).toBe(2);
      expect(await openSessions(userId)).toEqual([expired]);
      const revoked = await db.owner.query<{ id: string; revoked_at: Date }>('SELECT id, revoked_at FROM refresh_sessions WHERE id = ANY($1::uuid[])', [[tenantSession, platformSession]]);
      expect(revoked.rows.every((session) => session.revoked_at.getTime() === row!.out_reset_at.getTime())).toBe(true);
      expect((await db.owner.query('SELECT closed_at IS NOT NULL AS closed FROM support_sessions WHERE id = $1', [visit])).rows).toEqual([{ closed: true }]);
      expect(await openSessions(tenantA.userId)).toContain(othersSession);
      expect((await platformAuditRows(userId))[0]?.data).toMatchObject({ revokedSessions: 2, closedSupportSessions: 1 });
    });

    it('queues the notice to the user and one to the owner of every organization where they are an active member', async () => {
      const userId = await memberWithMfa(tenantA);
      await addMembership(tenantB, userId);
      await reset({ user: userId });
      expect(await noticesFor(userId)).toEqual(
        [
          { userId, kind: 'MFA_RESET_BY_SUPPORT' },
          { userId: tenantA.userId, kind: 'MEMBER_MFA_RESET_BY_SUPPORT', tenantId: tenantA.tenantId, memberId: userId },
          { userId: tenantB.userId, kind: 'MEMBER_MFA_RESET_BY_SUPPORT', tenantId: tenantB.tenantId, memberId: userId },
        ].sort((left, right) => left.userId.localeCompare(right.userId)),
      );
    });

    it('does not send an owner the members’ notice about themselves', async () => {
      const tenant = await seedTenant(db.platform);
      await db.platform.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
      await db.owner.query(ENABLE_MFA, [tenant.userId]);
      await reset({ user: tenant.userId });
      expect(await noticesFor(tenant.userId)).toEqual([{ userId: tenant.userId, kind: 'MFA_RESET_BY_SUPPORT' }]);
    });

    it('records the reason, the verification and the revoked sessions in the platform trail, with the IP', async () => {
      const userId = await memberWithMfa(tenantA);
      const [row] = await reset({ user: userId, method: 'CALLBACK_KNOWN_NUMBER', reason: `  ${REASON}  ` });
      expect(await platformAuditRows(userId)).toEqual([
        {
          id: row!.out_audit_id,
          actor_user_id: adminId,
          ip_address: '203.0.113.9',
          data: {
            userId,
            reason: REASON,
            verification: { method: 'CALLBACK_KNOWN_NUMBER', reference: REFERENCE },
            revokedSessions: 0,
            closedSupportSessions: 0,
            tenantIds: [tenantA.tenantId],
          },
        },
      ]);
    });

    it('writes one row in the trail of each organization where the user is an active member, without the reason', async () => {
      const userId = await memberWithMfa(tenantA);
      const invited = await seedTenant(db.platform);
      const inactive = await seedTenant(db.platform);
      const cancelled = await seedTenant(db.platform);
      await addMembership(tenantB, userId);
      await addMembership(invited, userId, 'INVITED');
      await addMembership(inactive, userId, 'INACTIVE');
      await addMembership(cancelled, userId);
      await db.platform.query(`UPDATE tenants SET status = 'CANCELLED' WHERE id = $1`, [cancelled.tenantId]);

      const [row] = await reset({ user: userId });

      const rows = await tenantAuditRows(userId);
      expect(rows.map((audit) => audit.tenant_id)).toEqual([tenantA.tenantId, tenantB.tenantId].sort());
      for (const audit of rows) {
        expect(audit).toMatchObject({ actor_id: null, entity_type: 'User', ip_address: '203.0.113.9', after: { platformAuditId: row!.out_audit_id, method: 'VIDEO_CALL' } });
        expect(JSON.stringify(audit.after)).not.toContain(REFERENCE);
        expect(JSON.stringify(audit.after)).not.toContain(REASON);
      }
    });

    it('tenant leak: an organization where the user is not a member gets no row, and a member of it reads none of the others', async () => {
      const userId = await memberWithMfa(tenantA);
      await reset({ user: userId });
      const seen = await withContext(db.runtime, { tenantId: tenantB.tenantId, userId: tenantB.userId }, async (client) =>
        (await client.query(`SELECT 1 FROM audit_logs WHERE action = 'account.mfa_reset_by_support' AND entity_id = $1`, [userId])).rows,
      );
      expect(seen).toEqual([]);
      expect((await tenantAuditRows(userId)).map((audit) => audit.tenant_id)).toEqual([tenantA.tenantId]);
    });

    it('answers no rows and changes nothing for a user without a second factor or an unknown one', async () => {
      const userId = await seedMember(db.platform, tenantA);
      expect(await reset({ user: userId })).toEqual([]);
      expect(await reset({ user: randomUUID() })).toEqual([]);
      expect(await noticesFor(userId)).toEqual([]);
      expect(await platformAuditRows(userId)).toEqual([]);
      expect(await tenantAuditRows(userId)).toEqual([]);
    });

    it('also resets another platform administrator (a colleague who lost the device)', async () => {
      const colleague = await newPlatformAdmin();
      await db.owner.query(ENABLE_MFA, [colleague]);
      expect(await reset({ user: colleague })).toHaveLength(1);
      expect(await noticesFor(colleague)).toEqual([{ userId: colleague, kind: 'MFA_RESET_BY_SUPPORT' }]);
    });
  });

  describe('refusals', () => {
    it('refuses an actor who is not an active platform administrator (42501)', async () => {
      const userId = await memberWithMfa(tenantA);
      expect(await sqlStateOf(() => reset({ admin: tenantA.userId, user: userId }))).toBe(SqlState.insufficientPrivilege);
      const disabled = await newPlatformAdmin();
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled]);
      expect(await sqlStateOf(() => reset({ admin: disabled, user: userId }))).toBe(SqlState.insufficientPrivilege);
      expect((await userState(userId))?.mfa_enabled).toBe(true);
    });

    it('refuses resetting one’s own factor (23514)', async () => {
      const self = await newPlatformAdmin();
      await db.owner.query(ENABLE_MFA, [self]);
      expect(await sqlStateOf(() => reset({ admin: self, user: self }))).toBe(SqlState.checkViolation);
    });

    it.each<[string, Partial<ResetInput>]>([
      ['an unknown method', { method: 'EMAIL' }],
      ['a short reason', { reason: '  short  ' }],
      ['a long reason', { reason: 'x'.repeat(501) }],
      ['a short reference', { reference: ' x ' }],
      ['a long reference', { reference: 'x'.repeat(201) }],
      ['a tenant administrator request without the requester', { method: 'TENANT_ADMIN_REQUEST' }],
      ['a requester with another method', { method: 'IN_PERSON', tenantAdmin: randomUUID() }],
    ])('refuses %s (22023)', async (_label, input) => {
      const userId = await memberWithMfa(tenantA);
      expect(await sqlStateOf(() => reset({ user: userId, ...input }))).toBe(INVALID_PARAMETER_VALUE);
      expect((await userState(userId))?.mfa_enabled).toBe(true);
    });

    it('runs only with the platform login', async () => {
      const userId = await memberWithMfa(tenantA);
      for (const pool of [db.runtime, db.worker]) {
        expect(await sqlStateOf(() => reset({ user: userId }, pool))).toBe(SqlState.insufficientPrivilege);
      }
    });
  });

  describe('a request of an organization administrator', () => {
    it('accepts the owner or an active admin of an organization of the user, and names them only in that organization’s trail', async () => {
      const userId = await memberWithMfa(tenantA);
      await addMembership(tenantB, userId);
      const [row] = await reset({ user: userId, method: 'TENANT_ADMIN_REQUEST', tenantAdmin: tenantA.userId });
      expect(row).toBeDefined();
      const rows = await tenantAuditRows(userId);
      expect(rows.find((audit) => audit.tenant_id === tenantA.tenantId)?.after).toEqual({ platformAuditId: row!.out_audit_id, method: 'TENANT_ADMIN_REQUEST', requestedById: tenantA.userId });
      expect(rows.find((audit) => audit.tenant_id === tenantB.tenantId)?.after).toEqual({ platformAuditId: row!.out_audit_id, method: 'TENANT_ADMIN_REQUEST' });
      expect((await platformAuditRows(userId))[0]?.data).toMatchObject({ verification: { method: 'TENANT_ADMIN_REQUEST', reference: REFERENCE, tenantAdminUserId: tenantA.userId } });
    });

    it('accepts an admin who is not the owner', async () => {
      const userId = await memberWithMfa(tenantA);
      const admin = await seedMember(db.platform, tenantA);
      expect(await reset({ user: userId, method: 'TENANT_ADMIN_REQUEST', tenantAdmin: admin })).toHaveLength(1);
    });

    it('refuses an administrator of another organization, a plain member, an inactive admin role, an inactive membership and the user themself (23514)', async () => {
      const userId = await memberWithMfa(tenantA);
      const plainRole = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantA.tenantId, `Member ${randomUUID()}`]);
      const inactiveAdminRole = await insertReturningId(db.platform, `INSERT INTO roles (tenant_id, name, is_admin, is_active) VALUES ($1, $2, true, false) RETURNING id`, [
        tenantA.tenantId,
        `Old admin ${randomUUID()}`,
      ]);
      const plain = await seedMember(db.platform, tenantA);
      await db.platform.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [plainRole, tenantA.tenantId, plain]);
      const withInactiveRole = await seedMember(db.platform, tenantA);
      await db.platform.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [inactiveAdminRole, tenantA.tenantId, withInactiveRole]);
      const inactive = await seedMember(db.platform, tenantA);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenantA.tenantId, inactive]);

      for (const requester of [tenantB.userId, plain, withInactiveRole, inactive, userId]) {
        expect(await sqlStateOf(() => reset({ user: userId, method: 'TENANT_ADMIN_REQUEST', tenantAdmin: requester }))).toBe(SqlState.checkViolation);
      }
      expect((await userState(userId))?.mfa_enabled).toBe(true);
    });
  });

  describe('login tokens issued before the reset', () => {
    const consume = (userId: string, issuedAt: Date) =>
      withContext(db.runtime, {}, async (client) => {
        const { rows } = await client.query<{ ok: boolean }>('SELECT auth_consume_login_token($1, $2, $3, $4, $5) AS ok', [
          randomUUID(),
          userId,
          'MFA_CHALLENGE',
          issuedAt,
          new Date(Date.now() + 120_000),
        ]);
        return rows[0]?.ok;
      });

    it('are refused; a token issued after it is accepted', async () => {
      const userId = await memberWithMfa(tenantA);
      const [row] = await reset({ user: userId });
      const resetAt = row!.out_reset_at.getTime();
      expect(await consume(userId, new Date(resetAt - 1_000))).toBe(false);
      expect(await consume(userId, new Date(resetAt))).toBe(false);
      expect(await consume(userId, new Date(resetAt + 1_000))).toBe(true);
    });
  });

  describe('the owners’ notice', () => {
    const enqueue = (recipient: string, kind: string, tenantId: string | null, memberId: string | null, pool = db.platform) =>
      withContext(pool, {}, async (client) => {
        const { rows } = await client.query<{ queued: boolean }>('SELECT enqueue_member_security_notice($1, $2, $3, $4) AS queued', [recipient, kind, tenantId, memberId]);
        return rows[0]?.queued;
      });
    const recipient = (owner: string, tenantId: string, member: string, pool = db.worker) =>
      withContext(pool, {}, async (client) => (await client.query('SELECT * FROM worker_member_security_notice_recipient($1, $2, $3)', [owner, tenantId, member])).rows);

    it('is queued only by the platform login, only for a known kind and only for a known recipient', async () => {
      const member = await seedMember(db.platform, tenantA);
      expect(await sqlStateOf(() => enqueue(tenantA.userId, 'MEMBER_MFA_RESET_BY_SUPPORT', tenantA.tenantId, member, db.runtime))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => enqueue(tenantA.userId, 'MEMBER_MFA_RESET_BY_SUPPORT', tenantA.tenantId, member, db.worker))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => enqueue(tenantA.userId, 'MFA_RESET_BY_SUPPORT', tenantA.tenantId, member))).toBe(INVALID_PARAMETER_VALUE);
      expect(await sqlStateOf(() => enqueue(tenantA.userId, 'MEMBER_MFA_RESET_BY_SUPPORT', null, member))).toBe(INVALID_PARAMETER_VALUE);
      expect(await enqueue(randomUUID(), 'MEMBER_MFA_RESET_BY_SUPPORT', tenantA.tenantId, member)).toBe(false);
      expect(await enqueue(tenantA.userId, 'MEMBER_MFA_RESET_BY_SUPPORT', tenantA.tenantId, member)).toBe(true);
    });

    it('cannot be queued through the personal notice function either', async () => {
      expect(await sqlStateOf(() => withContext(db.platform, {}, (client) => client.query(`SELECT enqueue_security_notice($1, 'MEMBER_MFA_RESET_BY_SUPPORT')`, [tenantA.userId])))).toBe(
        INVALID_PARAMETER_VALUE,
      );
    });

    it('is addressed by the worker only to an active owner of that organization, with the member’s name', async () => {
      const member = await seedMember(db.platform, tenantA);
      expect(await recipient(tenantA.userId, tenantA.tenantId, member)).toEqual([
        { out_email: expect.stringContaining('@example.com'), out_first_name: 'Test', out_time_zone: null, out_organization: expect.stringMatching(/^Tenant /), out_member_first_name: 'Test', out_member_last_name: expect.any(String) },
      ]);
      expect(await recipient(tenantB.userId, tenantA.tenantId, member)).toEqual([]);
      expect(await recipient(tenantA.userId, tenantB.tenantId, member)).toEqual([]);
      const plainMember = await seedMember(db.platform, tenantA);
      expect(await recipient(plainMember, tenantA.tenantId, member)).toEqual([]);
    });

    it('is not addressed to a disabled owner', async () => {
      const tenant = await seedTenant(db.platform);
      await db.platform.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, tenant.userId]);
      const member = await seedMember(db.platform, tenant);
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [tenant.userId]);
      expect(await recipient(tenant.userId, tenant.tenantId, member)).toEqual([]);
    });

    it('is not readable by the API login (app_platform owns it, like the other worker reads)', async () => {
      const member = await seedMember(db.platform, tenantA);
      expect(await sqlStateOf(() => recipient(tenantA.userId, tenantA.tenantId, member, db.runtime))).toBe(SqlState.insufficientPrivilege);
    });
  });

  describe('mfa_reset_at', () => {
    it('is not readable by the application login', async () => {
      const { rows } = await db.owner.query<{ readable: boolean }>(`SELECT has_column_privilege('app_runtime', 'public.users', 'mfa_reset_at', 'SELECT') AS readable`);
      expect(rows[0]?.readable).toBe(false);
    });
  });
});
