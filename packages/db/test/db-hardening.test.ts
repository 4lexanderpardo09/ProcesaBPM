import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, seedTicket, withPlatformTransaction, type SeededTicket } from './support/fixtures.js';

/**
 * S1 · Database hardening (docs/estado-backend-2026-10-04.md §2). Each test reproduces the
 * finding and asserts the fix.
 */
describe('database hardening (S1)', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });
  afterAll(() => db.close());

  // =========================================================================
  // 1. app_is_purging() is not spoofable by the runtime session
  // =========================================================================
  describe('the purge marker', () => {
    it('lets the runtime bypass the immutability of a published version by setting app.purge_tenant', async () => {
      const tenant = await seedTenant(db.platform);
      const ticket: SeededTicket = await seedTicket(db.platform, tenant);

      const code = await sqlStateOf(() =>
        withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, async (client) => {
          await client.query(`SELECT set_config('app.purge_tenant', $1, true)`, [tenant.tenantId]);
          await client.query('DELETE FROM transitions WHERE tenant_id = $1 AND version_id = $2', [tenant.tenantId, ticket.versionId]);
        }),
      );

      expect(code).toBe(SqlState.restrictViolation);
    });

    it('still lets a privileged session (the purge) bypass it', async () => {
      const tenant = await seedTenant(db.platform);
      const ticket = await seedTicket(db.platform, tenant);

      // No error: the purge runs SECURITY DEFINER as app_platform.
      await withoutContext(db.platform, async (client) => {
        await client.query(`SELECT set_config('app.purge_tenant', $1, true)`, [tenant.tenantId]);
        await client.query('DELETE FROM transitions WHERE tenant_id = $1 AND version_id = $2', [tenant.tenantId, ticket.versionId]);
      });
    });
  });

  // =========================================================================
  // 2. app_platform cannot create triggers to hide history
  // =========================================================================
  it('denies TRIGGER to app_platform', async () => {
    const code = await sqlStateOf(() =>
      db.platform.query(`CREATE TRIGGER hardening_probe AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_database_clock()`),
    );
    expect(code).toBe(SqlState.insufficientPrivilege);
  });

  // =========================================================================
  // 4. A support grant needs the tenant's consent (an owner or administrator)
  // =========================================================================
  it('rejects a support grant created by a member without full access', async () => {
    const tenant = await seedTenant(db.platform);
    const roleId = await insertReturningId(
      db.platform,
      `INSERT INTO roles (tenant_id, name, system_role) VALUES ($1, 'Agent', 'AGENT') RETURNING id`,
      [tenant.tenantId],
    );
    const agentId = await insertReturningId(
      db.platform,
      `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Ag', 'Ent') RETURNING id`,
      [`agent-${randomUUID()}@example.com`],
    );
    await withPlatformTransaction(db.platform, async (tx) => {
      await tx.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [tenant.tenantId, agentId, roleId]);
      await tx.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [tenant.tenantId, agentId, tenant.companyId]);
    });

    const code = await sqlStateOf(() =>
      withContext(db.runtime, { tenantId: tenant.tenantId, userId: agentId }, (client) =>
        client.query(
          `INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, expires_at) VALUES ($1, $2, 'agent tries it', now() + interval '1 hour')`,
          [tenant.tenantId, agentId],
        ),
      ),
    );
    expect(code).toBe(SqlState.insufficientPrivilege);
  });

  // =========================================================================
  // 5. A new membership starts INVITED
  // =========================================================================
  describe('a new membership', () => {
    it('cannot attach an existing global user as ACTIVE', async () => {
      const tenant = await seedTenant(db.platform);
      const stranger = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Stran', 'Ger') RETURNING id`,
        [`stranger-${randomUUID()}@example.com`],
      );

      const code = await sqlStateOf(() =>
        withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
          client.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [
            tenant.tenantId,
            stranger,
            tenant.roleId,
          ]),
        ),
      );
      expect(code).toBe(SqlState.insufficientPrivilege);
    });

    it('can be created as INVITED', async () => {
      const tenant = await seedTenant(db.platform);
      const invitee = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Invi', 'Tee') RETURNING id`,
        [`invitee-${randomUUID()}@example.com`],
      );

      await withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
        client.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'INVITED')`, [
          tenant.tenantId,
          invitee,
          tenant.roleId,
        ]),
      );
    });
  });

  // =========================================================================
  // 6. Platform-only e-mails have their own door
  // =========================================================================
  describe('platform e-mails', () => {
    it('cannot be queued by the tenant API through enqueue_platform_event', async () => {
      const user = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Pla', 'Tform') RETURNING id`,
        [`platform-${randomUUID()}@example.com`],
      );

      expect(
        await sqlStateOf(() =>
          db.runtime.query(`SELECT enqueue_platform_event('email.platform_admin_invitation', jsonb_build_object('userId', $1::uuid))`, [user]),
        ),
      ).toBe(SqlState.insufficientPrivilege);

      expect(
        await sqlStateOf(() =>
          db.runtime.query(`SELECT enqueue_platform_event('email.tenant_deletion_requested', jsonb_build_object('tenantId', $1::uuid, 'userId', $1::uuid))`, [user]),
        ),
      ).toBe(SqlState.insufficientPrivilege);
    });

    it('are queued through their own door by app_platform', async () => {
      const user = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Adm', 'Invite') RETURNING id`,
        [`admin-${randomUUID()}@example.com`],
      );
      const rows = await db.platform.query<{ id: string }>(`SELECT enqueue_platform_admin_invitation($1) AS id`, [user]);
      expect(rows.rows[0]?.id).toBeTruthy();
    });

    it('cannot be queued by app_runtime through their own door either', async () => {
      const user = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'No', 'Door') RETURNING id`,
        [`nodoor-${randomUUID()}@example.com`],
      );
      expect(await sqlStateOf(() => db.runtime.query(`SELECT enqueue_platform_admin_invitation($1)`, [user]))).toBe(SqlState.insufficientPrivilege);
    });
  });

  // =========================================================================
  // 7. Closing a support visit only closes the visit that was checked
  // =========================================================================
  describe('a support visit', () => {
    it('is not closed when the caller presents mismatched ids', async () => {
      const tenant = await seedTenant(db.platform);

      const admin = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Sup', 'Port') RETURNING id`,
        [`support-${randomUUID()}@example.com`],
      );
      await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [admin]);
      const platformSession = (
        await db.owner.query<{ id: string }>(
          `INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at, mfa_verified)
           VALUES ($1, NULL, $2, now() + interval '15 minutes', true) RETURNING id`,
          [admin, createHash('sha256').update(randomUUID()).digest('hex')],
        )
      ).rows[0]!.id;

      const grantId = (
        await withContext(db.runtime, { tenantId: tenant.tenantId, userId: tenant.userId }, (client) =>
          client.query<{ id: string }>(
            `INSERT INTO support_access_grants (tenant_id, granted_by_id, reason, expires_at)
             VALUES ($1, $2, 'Investigating', now() + interval '1 hour') RETURNING id`,
            [tenant.tenantId, tenant.userId],
          ),
        )
      ).rows[0]!.id;

      const sessionId = (
        await withoutContext(db.platform, (client) =>
          client.query<{ out_session_id: string }>('SELECT * FROM platform_open_support_session($1, $2, $3)', [tenant.tenantId, admin, platformSession]),
        )
      ).rows[0]!.out_session_id;

      // The caller presents the victim's tenant and session but a different grant and admin.
      const stranger = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Wrong', 'Grant') RETURNING id`,
        [`wrong-${randomUUID()}@example.com`],
      );
      const ok = (
        await withContext(db.runtime, { tenantId: tenant.tenantId, userId: admin }, (client) =>
          client.query<{ ok: boolean }>('SELECT auth_verify_support_session($1, $2, $3, $4) AS ok', [tenant.tenantId, sessionId, stranger, stranger]),
        )
      ).rows[0]!.ok;
      expect(ok).toBe(false);

      const closed = (await db.owner.query<{ closed_at: Date | null }>('SELECT closed_at FROM support_sessions WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, sessionId])).rows[0]!.closed_at;
      expect(closed).toBeNull();
    });
  });
});
