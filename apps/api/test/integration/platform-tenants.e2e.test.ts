import type { INestApplication } from '@nestjs/common';
import { DEFAULT_ERROR_TYPES, DEFAULT_PRIORITIES, ROLE_TEMPLATES } from '@procesabpm/db';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BackgroundTasks } from '../../src/common/background/background-tasks.js';
import { TenantOwnerInviter } from '../../src/modules/platform/application/tenant-owner-inviter.js';
import { sha256Hex } from '../../src/infrastructure/security/token-utils.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform, type PlatformAdminUser } from '../support/platform-fixtures.js';
import { TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker, tokenOf } from '../support/worker-mail.js';

useTestEnvironment();

const OWNER_PASSWORD = 'owner chosen password 123';
const slugOf = () => `signup-${Math.random().toString(36).slice(2, 10)}`;

interface InvitationPayload {
  userId: string;
  tenantId: string;
}

describe('platform tenant sign-up', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: PlatformAdminUser;
  let adminToken: string;

  const http = () => request(app.getHttpServer());
  const body = (overrides: Record<string, unknown> = {}) => ({
    slug: slugOf(),
    name: 'Acme Corp',
    planCode: 'professional',
    countryCode: 'CO',
    owner: { email: `owner-${Math.random().toString(36).slice(2, 10)}@example.com`, firstName: 'Olga', lastName: 'Owner' },
    ...overrides,
  });
  const signUp = (payload: object, token = adminToken) => http().post('/platform/tenants').set(bearer(token)).send(payload);

  const count = async (table: string, tenantId: string) =>
    (await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [tenantId])).rows[0]!.n;

  let mail: MailWorker;
  /** Lets the worker deliver and returns the token of the newest link mailed to the address. */
  const linkTokenFor = async (email: string): Promise<string> => {
    await mail.deliver({ retries: true });
    return tokenOf(mail.lastTo(email)!);
  };

  const invitationEvent = async (tenantId: string) =>
    (
      await db.owner.query<{ payload: InvitationPayload }>(
        `SELECT payload FROM platform_outbox_events WHERE type = 'email.invitation' AND payload ->> 'tenantId' = $1`,
        [tenantId],
      )
    ).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp({ controllers: [TenantProbeController] }));
    admin = await seedPlatformAdmin(db);
    adminToken = await signInPlatform(app, db, admin);
    mail = await MailWorker.start();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('POST /platform/tenants', () => {
    it('creates the tenant with every default piece, in one transaction', async () => {
      const payload = body();
      const response = await signUp(payload).expect(201);
      const { tenantId, ownerUserId } = response.body as { tenantId: string; slug: string; ownerUserId: string };
      expect(response.body.slug).toBe(payload.slug);

      const { rows: tenants } = await db.owner.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
      expect(tenants[0]).toMatchObject({ slug: payload.slug, name: 'Acme Corp', status: 'ACTIVE', country_code: 'CO', time_zone: 'America/Bogota' });
      expect(await count('tenant_usage', tenantId)).toBe(1);

      const { rows: companies } = await db.owner.query(`SELECT * FROM companies WHERE tenant_id = $1`, [tenantId]);
      expect(companies).toHaveLength(1);
      expect(companies[0]).toMatchObject({ is_default: true, country_code: 'CO', currency_code: 'COP', time_zone: 'America/Bogota' });

      const { rows: calendars } = await db.owner.query(`SELECT * FROM calendars WHERE tenant_id = $1`, [tenantId]);
      expect(calendars).toHaveLength(1);
      expect(calendars[0]).toMatchObject({ is_default: true });
      expect(companies[0].calendar_id).toBe(calendars[0].id);

      const { rows: hours } = await db.owner.query<{ weekday: number; slot: string }>(
        `SELECT weekday, to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') AS slot
         FROM calendar_working_hours WHERE tenant_id = $1 ORDER BY weekday, start_time`,
        [tenantId],
      );
      expect(hours).toHaveLength(10);
      expect(hours.map((row) => row.weekday)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
      expect([...new Set(hours.map((row) => row.slot))].sort()).toEqual(['08:00-12:00', '14:00-18:00']);

      const year = new Date().getUTCFullYear();
      const { rows: holidays } = await db.owner.query<{ date: string }>(
        `SELECT date::text AS date FROM calendar_holidays WHERE tenant_id = $1 ORDER BY date`,
        [tenantId],
      );
      const { rows: expectedHolidays } = await db.owner.query<{ date: string }>(
        `SELECT date::text AS date FROM country_holidays WHERE country_code = 'CO' AND date BETWEEN $1 AND $2 ORDER BY date`,
        [`${year}-01-01`, `${year + 1}-12-31`],
      );
      expect(holidays.length).toBeGreaterThan(0);
      expect(holidays).toEqual(expectedHolidays);

      const { rows: roles } = await db.owner.query<{ system_role: string; name: string }>(
        `SELECT system_role, name FROM roles WHERE tenant_id = $1 ORDER BY system_role`,
        [tenantId],
      );
      expect(roles.map((role) => role.system_role).sort()).toEqual(ROLE_TEMPLATES.map((template) => template.systemRole).sort());

      const { rows: agentReports } = await db.owner.query<{ conditions: unknown }>(
        `SELECT rp.conditions FROM role_permissions rp JOIN roles r ON r.tenant_id = rp.tenant_id AND r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.tenant_id = $1 AND r.system_role = 'AGENT' AND p.action = 'read' AND p.subject = 'Report'`,
        [tenantId],
      );
      expect(agentReports).toEqual([{ conditions: { departmentId: '${membership.departmentId}' } }]);

      const { rows: groupTypes } = await db.owner.query(`SELECT name, is_default FROM approval_group_types WHERE tenant_id = $1`, [tenantId]);
      expect(groupTypes).toEqual([{ name: 'General', is_default: true }]);

      const { rows: priorities } = await db.owner.query<{ name: string }>(`SELECT name FROM priorities WHERE tenant_id = $1 ORDER BY sort_order`, [tenantId]);
      expect(priorities.map((row) => row.name)).toEqual(DEFAULT_PRIORITIES.map((priority) => priority.name));

      const { rows: errorTypes } = await db.owner.query<{ name: string; is_reopening: boolean }>(`SELECT name, is_reopening FROM error_types WHERE tenant_id = $1`, [tenantId]);
      expect(errorTypes.map((row) => row.name).sort()).toEqual(DEFAULT_ERROR_TYPES.map((type) => type.name).sort());
      expect(errorTypes.filter((row) => row.is_reopening).map((row) => row.name)).toEqual(['Reapertura']);

      const { rows: memberships } = await db.owner.query(
        `SELECT m.*, r.system_role, r.is_admin FROM memberships m JOIN roles r ON r.tenant_id = m.tenant_id AND r.id = m.role_id WHERE m.tenant_id = $1`,
        [tenantId],
      );
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ user_id: ownerUserId, status: 'INVITED', is_owner: true, system_role: 'ADMIN', is_admin: true });
      const { rows: ownerCompanies } = await db.owner.query(`SELECT company_id FROM membership_companies WHERE tenant_id = $1 AND user_id = $2`, [tenantId, ownerUserId]);
      expect(ownerCompanies).toEqual([{ company_id: companies[0].id }]);

      const [event] = await invitationEvent(tenantId);
      expect(event!.payload).toEqual({ userId: ownerUserId, tenantId });
      const token = await linkTokenFor(payload.owner.email);
      expect(mail.lastTo(payload.owner.email)!.text).toContain('Acme Corp');
      const { rows: tokens } = await db.owner.query(`SELECT type, invited_tenant_id, consumed_at FROM user_tokens WHERE token_hash = $1 AND user_id = $2`, [
        sha256Hex(token),
        ownerUserId,
      ]);
      expect(tokens).toEqual([{ type: 'INVITATION', invited_tenant_id: tenantId, consumed_at: null }]);

      const { rows: audit } = await db.owner.query(`SELECT actor_user_id, action FROM platform_audit_logs WHERE target_tenant_id = $1`, [tenantId]);
      expect(audit).toEqual([{ actor_user_id: admin.userId, action: 'tenant.created' }]);
      const { rows: origin } = await db.owner.query<{ ip_address: string | null }>(`SELECT ip_address FROM platform_audit_logs WHERE target_tenant_id = $1`, [tenantId]);
      expect(origin[0]?.ip_address).toBeTruthy();
    });

    it('the owner accepts the invitation, signs in, sees the tenant and has full access', async () => {
      const payload = body();
      const { tenantId } = (await signUp(payload).expect(201)).body as { tenantId: string };
      await http().post('/auth/invitations/accept').send({ token: await linkTokenFor(payload.owner.email), password: OWNER_PASSWORD }).expect(200);
      // Selection tokens issued in the same second as the password change are refused (iat has whole seconds).
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const login = await http().post('/auth/login').send({ email: payload.owner.email, password: OWNER_PASSWORD }).expect(200);
      expect(login.body.organizations.map((tenant: { tenantId: string }) => tenant.tenantId)).toEqual([tenantId]);

      const session = await signIn(app, payload.owner.email, tenantId, OWNER_PASSWORD);
      const me = await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body.user).toMatchObject({ email: payload.owner.email });
      const companies = await http().get('/test/companies').set(bearer(session.accessToken)).expect(200);
      expect(companies.body).toEqual([{ tenantId, name: 'Empresa principal' }]);
    });

    it('answers 409 for a duplicate slug and creates nothing the second time', async () => {
      const payload = body();
      await signUp(payload).expect(201);
      const { rows: before } = await db.owner.query(`SELECT count(*)::int AS n FROM users`);
      const response = await signUp(body({ slug: payload.slug })).expect(409);
      expect(response.body.error.code).toBe('TENANT_SLUG_TAKEN');
      expect((await db.owner.query(`SELECT count(*)::int AS n FROM users`)).rows).toEqual(before);
    });

    it('concurrent sign-ups with the same slug: exactly one wins, the other gets 409', async () => {
      const slug = slugOf();
      const results = await Promise.all([signUp(body({ slug })), signUp(body({ slug }))]);
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect((await db.owner.query(`SELECT count(*)::int AS n FROM tenants WHERE slug = $1`, [slug])).rows[0].n).toBe(1);
    });

    it.each([
      ['an unknown plan', { planCode: 'does-not-exist' }],
      ['an unknown country', { countryCode: 'ZZ' }],
    ])('answers 422 for %s and leaves no tenant behind', async (_label, override) => {
      const payload = body(override);
      const response = await signUp(payload).expect(422);
      expect(response.body.error.code).toBe('INVALID_REFERENCE');
      expect((await db.owner.query(`SELECT 1 FROM tenants WHERE slug = $1`, [payload.slug])).rowCount).toBe(0);
    });

    it('refuses an invalid slug (400) and a disabled owner account (422)', async () => {
      await signUp(body({ slug: 'Not Valid' })).expect(400);
      const payload = body();
      await db.platform.query(`INSERT INTO users (email, first_name, last_name, status) VALUES ($1, 'D', 'U', 'DISABLED')`, [payload.owner.email]);
      await signUp(payload).expect(422);
      expect((await db.owner.query(`SELECT 1 FROM tenants WHERE slug = $1`, [payload.slug])).rowCount).toBe(0);
    });

    it('an existing user becomes owner of the new tenant without changing their password', async () => {
      const other = await seedTenant(db.platform);
      const existing = await seedUser(db, other);
      const { rows: before } = await db.owner.query(`SELECT password_hash FROM users WHERE id = $1`, [existing.userId]);
      const payload = body({ owner: { email: existing.email, firstName: 'Ex', lastName: 'Isting' } });
      const { tenantId, ownerUserId } = (await signUp(payload).expect(201)).body as { tenantId: string; ownerUserId: string };
      expect(ownerUserId).toBe(existing.userId);
      expect((await db.owner.query(`SELECT password_hash FROM users WHERE id = $1`, [existing.userId])).rows).toEqual(before);
      expect(await count('memberships', tenantId)).toBe(1);
    });

    it('a failure in the last step rolls back the whole sign-up', async () => {
      const payload = body();
      const inviter = app.get(TenantOwnerInviter, { strict: false });
      const spy = vi.spyOn(inviter, 'invite').mockRejectedValueOnce(new Error('boom'));
      await signUp(payload).expect(500);
      spy.mockRestore();
      expect((await db.owner.query(`SELECT 1 FROM tenants WHERE slug = $1`, [payload.slug])).rowCount).toBe(0);
      expect((await db.owner.query(`SELECT 1 FROM users WHERE email = $1`, [payload.owner.email])).rowCount).toBe(0);
      await signUp(payload).expect(201);
    });

    it('does not touch the data of any other tenant', async () => {
      const other = await seedTenant(db.platform);
      await seedUser(db, other);
      const tables = (
        await db.owner.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'
           AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE') ORDER BY table_name`,
        )
      ).rows.map((row) => row.table_name);
      const fingerprint = async () =>
        Promise.all(
          tables.map(async (table) => [
            table,
            (await db.owner.query(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash FROM ${table} t WHERE tenant_id = $1`, [other.tenantId])).rows[0].hash,
          ]),
        );
      const before = await fingerprint();
      await signUp(body()).expect(201);
      expect(await fingerprint()).toEqual(before);
    });
  });

  describe('access control', () => {
    it('answers 401 without a token and with a malformed one', async () => {
      await http().post('/platform/tenants').send(body()).expect(401);
      await http().post('/platform/tenants').set('authorization', 'Bearer nope').send(body()).expect(401);
    });

    it('a normal tenant user (tenant access token, even an owner) gets 403', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      const response = await signUp(body(), session.accessToken).expect(403);
      expect(response.body.error.code).toBe('PERMISSION_DENIED');
    });

    it('a normal user cannot open a platform session', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
      expect(login.body.platformAdmin).toBe(false);
      await http().post('/auth/platform/select').set(bearer(login.body.selectionToken)).expect(403);
    });

    it('a platform token does not open tenant routes', async () => {
      await http().get('/auth/me').set(bearer(adminToken)).expect(401);
      await http().get('/test/companies').set(bearer(adminToken)).expect(401);
    });

    it('the platform session stops working when the administrator is removed', async () => {
      const temporary = await seedPlatformAdmin(db);
      const token = await signInPlatform(app, db, temporary);
      await signUp(body(), token).expect(201);
      await db.platform.query('DELETE FROM platform_admins WHERE user_id = $1', [temporary.userId]);
      await signUp(body(), token).expect(401);
    });

    it('a password reset revokes the platform session', async () => {
      const temporary = await seedPlatformAdmin(db);
      const token = await signInPlatform(app, db, temporary);
      await http().post('/auth/password-reset/request').send({ email: temporary.email }).expect(202);
      await app.get(BackgroundTasks).whenIdle();
      await http().post('/auth/password-reset/confirm').send({ token: await linkTokenFor(temporary.email), newPassword: OWNER_PASSWORD }).expect(204);
      await signUp(body(), token).expect(401);
    });

    it('logging out of the platform revokes the session', async () => {
      const temporary = await seedPlatformAdmin(db);
      const token = await signInPlatform(app, db, temporary);
      await http().post('/auth/platform/logout').set(bearer(token)).expect(204);
      await signUp(body(), token).expect(401);
    });
  });

  describe('suspend and reactivate', () => {
    const post = (path: string, token = adminToken) => http().post(path).set(bearer(token));

    it('suspends: members get TENANT_SUSPENDED; reactivating restores access', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);

      expect((await post(`/platform/tenants/${tenant.tenantId}/suspend`).expect(200)).body).toEqual({ tenantId: tenant.tenantId, status: 'SUSPENDED' });
      const suspended = await http().get('/auth/me').set(bearer(session.accessToken)).expect(403);
      expect(suspended.body.error.code).toBe('TENANT_SUSPENDED');

      expect((await post(`/platform/tenants/${tenant.tenantId}/reactivate`).expect(200)).body).toEqual({ tenantId: tenant.tenantId, status: 'ACTIVE' });
      await http().get('/auth/me').set(bearer(session.accessToken)).expect(200);

      const { rows } = await db.owner.query(`SELECT action FROM platform_audit_logs WHERE target_tenant_id = $1 ORDER BY created_at`, [tenant.tenantId]);
      expect(rows.map((row) => row.action)).toEqual(['tenant.suspended', 'tenant.reactivated']);
    });

    it('repeating the change is idempotent and audited once', async () => {
      const tenant = await seedTenant(db.platform);
      await post(`/platform/tenants/${tenant.tenantId}/suspend`).expect(200);
      await post(`/platform/tenants/${tenant.tenantId}/suspend`).expect(200);
      expect((await db.owner.query(`SELECT 1 FROM platform_audit_logs WHERE target_tenant_id = $1`, [tenant.tenantId])).rowCount).toBe(1);
    });

    it('answers 404 for an unknown tenant, 400 for a malformed id and 422 for a cancelled tenant', async () => {
      await post('/platform/tenants/018f3c1e-7b2a-7c3d-9e4f-0123456789ab/suspend').expect(404);
      await post('/platform/tenants/not-a-uuid/suspend').expect(400);
      const tenant = await seedTenant(db.platform);
      await db.platform.query(`UPDATE tenants SET status = 'CANCELLED' WHERE id = $1`, [tenant.tenantId]);
      const response = await post(`/platform/tenants/${tenant.tenantId}/reactivate`).expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
    });

    it('a tenant user cannot suspend a tenant', async () => {
      const tenant = await seedTenant(db.platform);
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await post(`/platform/tenants/${tenant.tenantId}/suspend`, session.accessToken).expect(403);
    });
  });
});
