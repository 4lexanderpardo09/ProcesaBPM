import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationFailedError } from '@procesabpm/shared';
import { PlatformTransactionRunner } from '../../src/infrastructure/database/platform-transaction-runner.js';
import { authMailEs } from '../../src/modules/auth/i18n/es.js';
import { PlatformUserRepository } from '../../src/modules/platform/data/platform-user.repository.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { addMembership, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, logInWithMfa, rewindReplayGuard, type MfaCredentials } from '../support/mfa-fixtures.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin, signInPlatform, type PlatformAdminUser } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

const REQUEST = { reason: 'Lost the phone and the backup codes', verification: { method: 'VIDEO_CALL', reference: 'CASE-1234' } } as const;

interface MfaUser extends TestUser {
  readonly mfa: MfaCredentials;
}

describe('MFA reset by a platform administrator', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let admin: PlatformAdminUser;
  let adminToken: string;
  let ownerA: TestUser;

  const http = () => request(app.getHttpServer());
  const lookup = (email: string, token = adminToken) => http().get('/platform/users').query({ email }).set(bearer(token));
  const reset = (userId: string, body: object = REQUEST, token = adminToken) => http().post(`/platform/users/${userId}/mfa-reset`).set(bearer(token)).send(body);

  async function mfaMember(tenant: SeededTenant): Promise<MfaUser> {
    const user = await seedUser(db, tenant);
    return { ...user, mfa: await enableMfa(db, user.userId) };
  }

  /** Login with the second factor and selection of the tenant. */
  async function signInWithMfa(user: MfaUser, tenant: SeededTenant) {
    const selection = await logInWithMfa(app, db, user, user.mfa);
    const response = await http().post('/auth/select-tenant').set(bearer(selection)).send({ tenantId: tenant.tenantId }).expect(200);
    return response.body.accessToken as string;
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([grantEverything(db, tenantA), grantEverything(db, tenantB)]);
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    admin = await seedPlatformAdmin(db);
    adminToken = await signInPlatform(app, db, admin);
    ownerA = await seedUser(db, tenantA);
    await db.platform.query('UPDATE memberships SET is_owner = true WHERE tenant_id = $1 AND user_id = $2', [tenantA.tenantId, ownerA.userId]);
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('GET /platform/users', () => {
    it('finds an account by its exact e-mail, with its memberships and without secrets, and audits the id', async () => {
      const user = await mfaMember(tenantA);
      await addMembership(db, tenantB, user.userId);
      const response = await lookup(user.email.toUpperCase()).expect(200);
      expect(response.body).toEqual({
        id: user.userId,
        firstName: 'Test',
        lastName: expect.any(String),
        status: 'ACTIVE',
        mfaEnabled: true,
        isPlatformAdmin: false,
        memberships: expect.arrayContaining([
          { tenantId: tenantA.tenantId, tenantName: expect.any(String), status: 'ACTIVE', isOwner: false },
          { tenantId: tenantB.tenantId, tenantName: expect.any(String), status: 'ACTIVE', isOwner: false },
        ]),
      });
      expect(JSON.stringify(response.body)).not.toMatch(/password|secret|hash|email/i);
      const audit = await db.owner.query(`SELECT actor_user_id, data FROM platform_audit_logs WHERE action = 'user.looked_up' AND data ->> 'userId' = $1`, [user.userId]);
      expect(audit.rows).toEqual([{ actor_user_id: admin.userId, data: { userId: user.userId } }]);
      expect(JSON.stringify(audit.rows)).not.toContain(user.email);
    });

    it('never matches a prefix or a search, answers 404 for them and audits the miss without the e-mail', async () => {
      const user = await mfaMember(tenantA);
      const misses = async () =>
        Number((await db.owner.query(`SELECT count(*) FROM platform_audit_logs WHERE action = 'user.looked_up' AND actor_user_id = $1 AND data = '{"userId": null}'`, [admin.userId])).rows[0].count);
      const before = await misses();
      await lookup(user.email.slice(0, -4)).expect(400);
      await lookup(`${user.email.split('@')[0]!.slice(0, 5)}@example.com`).expect(404);
      await http().get('/platform/users').query({ email: user.email, search: 'x' }).set(bearer(adminToken)).expect(400);
      expect(await misses()).toBe(before + 1);
    });
  });

  describe('POST /platform/users/:userId/mfa-reset', () => {
    it('resets the factor and ends every session: the access token answers 401 and the refresh fails', async () => {
      const user = await mfaMember(tenantA);
      const accessToken = await signInWithMfa(user, tenantA);
      await http().get('/auth/me').set(bearer(accessToken)).expect(200);
      const refreshCookie = (await signIn(app, ownerA.email, tenantA.tenantId)).refreshCookie;

      const response = await reset(user.userId).expect(200);

      expect(response.body).toEqual({ resetAt: expect.any(String), revokedSessions: 1 });
      await http().get('/auth/me').set(bearer(accessToken)).expect(401);
      // Somebody else's session is untouched.
      await http().post('/auth/refresh').set('cookie', refreshCookie).expect(200);
      const mfa = await db.owner.query('SELECT mfa_enabled FROM users WHERE id = $1', [user.userId]);
      expect(mfa.rows).toEqual([{ mfa_enabled: false }]);
    });

    it('voids an MFA challenge issued before the reset', async () => {
      const user = await mfaMember(tenantA);
      await rewindReplayGuard(db, user.userId);
      const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
      expect(login.body.step).toBe('MFA_REQUIRED');
      await reset(user.userId).expect(200);
      await http().post('/auth/login/mfa').set(bearer(login.body.challengeToken)).send({ code: currentCode(user.mfa.secret) }).expect(401);
    });

    it('next login: enrollment again in an organization that requires MFA, straight to the organizations otherwise', async () => {
      const policyTenant = await seedTenant(db.platform);
      await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [policyTenant.tenantId]);
      const strict = await mfaMember(policyTenant);
      const relaxed = await mfaMember(tenantA);
      await reset(strict.userId).expect(200);
      await reset(relaxed.userId).expect(200);

      const strictLogin = await http().post('/auth/login').send({ email: strict.email, password: strict.password }).expect(200);
      expect(strictLogin.body).toMatchObject({ step: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' });
      const relaxedLogin = await http().post('/auth/login').send({ email: relaxed.email, password: relaxed.password }).expect(200);
      expect(relaxedLogin.body.step).toBe('SELECT_ORGANIZATION');
    });

    it('the organization admin sees it in the audit log; tenant leak: another organization sees nothing', async () => {
      const user = await mfaMember(tenantA);
      await reset(user.userId, { ...REQUEST, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-9', tenantAdminUserId: ownerA.userId } }).expect(200);

      const adminA = await signIn(app, ownerA.email, tenantA.tenantId);
      const seenA = await http().get('/audit-logs').query({ action: 'account.mfa_reset_by_support' }).set(bearer(adminA.accessToken)).expect(200);
      const rows = seenA.body.items.filter((item: { subjectId: string }) => item.subjectId === user.userId);
      expect(rows).toEqual([expect.objectContaining({ actor: null, action: 'account.mfa_reset_by_support', subjectType: 'User', after: expect.objectContaining({ method: 'TENANT_ADMIN_REQUEST', requestedById: ownerA.userId }) })]);
      expect(JSON.stringify(rows)).not.toContain('CASE-9');

      const adminB = await seedUser(db, tenantB);
      const sessionB = await signIn(app, adminB.email, tenantB.tenantId);
      const seenB = await http().get('/audit-logs').query({ action: 'account.mfa_reset_by_support' }).set(bearer(sessionB.accessToken)).expect(200);
      expect(seenB.body.items.filter((item: { subjectId: string }) => item.subjectId === user.userId)).toEqual([]);

      const platformAudit = await db.owner.query(`SELECT actor_user_id, data, ip_address FROM platform_audit_logs WHERE action = 'user.mfa_reset' AND data ->> 'userId' = $1`, [user.userId]);
      expect(platformAudit.rows).toEqual([
        {
          actor_user_id: admin.userId,
          ip_address: expect.any(String),
          data: expect.objectContaining({ reason: REQUEST.reason, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-9', tenantAdminUserId: ownerA.userId } }),
        },
      ]);
    });

    it('mails the user and the owner of the organization', async () => {
      const user = await mfaMember(tenantA);
      await reset(user.userId).expect(200);
      const toUser = await mail.waitForMail(user.email);
      expect(toUser.subject).toBe(authMailEs.securityNotice.subject.MFA_RESET_BY_SUPPORT);
      // The owner also hears about the other resets in this file: pick the mail about this member.
      await mail.deliver({ retries: true });
      const { rows } = await db.owner.query<{ name: string }>(`SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [user.userId]);
      const aboutMember = mail.mailer.to(ownerA.email).filter((message) => message.text.includes(rows[0]!.name));
      expect(aboutMember.map((message) => message.subject)).toEqual([authMailEs.memberSecurityNotice.subject.MEMBER_MFA_RESET_BY_SUPPORT]);
    });

    it('answers 409 without a second factor, 404 for an unknown user and 422 for one’s own factor or a requester who does not administer', async () => {
      const plain = await seedUser(db, tenantA);
      expect((await reset(plain.userId).expect(409)).body.error.code).toBe('MFA_NOT_ENABLED');
      await reset('0198a000-0000-7000-8000-000000000000').expect(404);
      expect((await reset(admin.userId).expect(422)).body.error.code).toBe('INVALID_STATE');
      const user = await mfaMember(tenantA);
      const outsider = await seedUser(db, tenantB);
      await reset(user.userId, { ...REQUEST, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-1', tenantAdminUserId: outsider.userId } }).expect(422);
      expect((await db.owner.query('SELECT mfa_enabled FROM users WHERE id = $1', [user.userId])).rows).toEqual([{ mfa_enabled: true }]);
    });

    it('refuses another platform administrator’s factor (422 INVALID_STATE): that recovery is an operator runbook', async () => {
      const colleague = await seedPlatformAdmin(db);
      expect((await reset(colleague.userId).expect(422)).body.error.code).toBe('INVALID_STATE');
      expect((await db.owner.query('SELECT mfa_enabled FROM users WHERE id = $1', [colleague.userId])).rows).toEqual([{ mfa_enabled: true }]);
    });

    it('counts characters like the database: a reason of 300 emoji is accepted end to end', async () => {
      const user = await mfaMember(tenantA);
      await reset(user.userId, { ...REQUEST, reason: '🔐'.repeat(300) }).expect(200);
      const other = await mfaMember(tenantA);
      await reset(other.userId, { ...REQUEST, reason: '🔐'.repeat(501) }).expect(400);
    });

    it('turns the function’s own argument checks (22023) into a validation error, not a 500', async () => {
      const user = await mfaMember(tenantA);
      const command = { administratorId: admin.userId, userId: user.userId, reason: 'x', method: 'VIDEO_CALL', reference: 'CASE-1', tenantAdminUserId: null, ipAddress: null } as const;
      await expect(app.get(PlatformTransactionRunner).run((tx) => app.get(PlatformUserRepository).resetMfa(tx, command))).rejects.toBeInstanceOf(ValidationFailedError);
    });

    it('refuses an invalid body (400)', async () => {
      const user = await mfaMember(tenantA);
      await reset(user.userId, { reason: 'short', verification: REQUEST.verification }).expect(400);
      await reset(user.userId, { ...REQUEST, verification: { method: 'EMAIL', reference: 'CASE-1' } }).expect(400);
      await reset(user.userId, { ...REQUEST, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-1' } }).expect(400);
      await http().post('/platform/users/not-a-uuid/mfa-reset').set(bearer(adminToken)).send(REQUEST).expect(400);
    });
  });

  describe('authorization', () => {
    it('refuses a tenant token (403) and no token (401) on both routes, even from an organization administrator', async () => {
      const user = await mfaMember(tenantA);
      const tenantSession = await signIn(app, ownerA.email, tenantA.tenantId);
      await lookup(user.email, tenantSession.accessToken).expect(403);
      await reset(user.userId, REQUEST, tenantSession.accessToken).expect(403);
      await http().get('/platform/users').query({ email: user.email }).expect(401);
      await http().post(`/platform/users/${user.userId}/mfa-reset`).send(REQUEST).expect(401);
      expect((await db.owner.query('SELECT mfa_enabled FROM users WHERE id = $1', [user.userId])).rows).toEqual([{ mfa_enabled: true }]);
    });
  });

  describe('rate limits', () => {
    let limitedApp: INestApplication;
    let limitedAdmin: PlatformAdminUser;
    let limitedToken: string;
    const limited = () => request(limitedApp.getHttpServer());

    beforeAll(async () => {
      ({ app: limitedApp } = await createTestApp({ rateLimiting: true }));
      limitedAdmin = await seedPlatformAdmin(db);
      limitedToken = await signInPlatform(limitedApp, db, limitedAdmin);
    });
    afterAll(async () => {
      await limitedApp.close();
    });

    it('allows 3 resets of one user a day (the 4th answers 429), counted across administrators', async () => {
      const user = await mfaMember(tenantA);
      const other = await seedPlatformAdmin(db);
      const otherToken = await signInPlatform(limitedApp, db, other);
      for (const token of [limitedToken, otherToken, limitedToken]) {
        await limited().post(`/platform/users/${user.userId}/mfa-reset`).set(bearer(token)).send(REQUEST).expect(200);
        await enableMfa(db, user.userId);
      }
      const refused = await limited().post(`/platform/users/${user.userId}/mfa-reset`).set(bearer(otherToken)).send(REQUEST).expect(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });

    it('allows 10 resets an hour per administrator (the 11th answers 429)', async () => {
      const busy = await seedPlatformAdmin(db);
      const busyToken = await signInPlatform(limitedApp, db, busy);
      for (let index = 0; index < 10; index += 1) {
        await limited().post(`/platform/users/0198a000-0000-7000-8000-00000000000${index % 10}/mfa-reset`).set(bearer(busyToken)).send(REQUEST).expect(404);
      }
      await limited().post('/platform/users/0198a000-0000-7000-8000-000000000010/mfa-reset').set(bearer(busyToken)).send(REQUEST).expect(429);
    });
  });
});
