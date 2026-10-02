import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../src/infrastructure/security/jwt-token-service.js';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { bearer, TEST_PASSWORD } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, type MfaCredentials } from '../support/mfa-fixtures.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin } from '../support/platform-fixtures.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('two-step verification at login', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  const clock = new TestClock(new Date());

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = TEST_PASSWORD) => http().post('/auth/login').send({ email, password });
  const verify = (challengeToken: string, body: object) => http().post('/auth/login/mfa').set(bearer(challengeToken)).send(body);
  const select = (token: string) => http().post('/auth/select-tenant').set(bearer(token)).send({ tenantId: tenant.tenantId });
  const codeNow = (mfa: MfaCredentials, stepOffset = 0) => currentCode(mfa.secret, stepOffset, clock.now().getTime());

  async function userWithMfa() {
    const user = await seedUser(db, tenant);
    return { user, mfa: await enableMfa(db, user.userId) };
  }
  const lastLoginAt = async (userId: string) => (await db.owner.query<{ last_login_at: Date | null }>('SELECT last_login_at FROM users WHERE id = $1', [userId])).rows[0]?.last_login_at;
  async function challengeOf(email: string): Promise<string> {
    const response = await login(email).expect(200);
    expect(response.body.step).toBe('MFA_REQUIRED');
    return response.body.challengeToken as string;
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    ({ app } = await createTestApp({ clock }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('an account with MFA', () => {
    it('the password alone gets a challenge, no selection token and no session; the right code completes the sign-in', async () => {
      const { user, mfa } = await userWithMfa();
      const first = await login(user.email).expect(200);
      expect(first.body).toEqual({ step: 'MFA_REQUIRED', challengeToken: expect.any(String), expiresIn: 300, methods: ['TOTP', 'BACKUP_CODE'] });
      expect(first.body.selectionToken).toBeUndefined();
      expect((await lastLoginAt(user.userId))).toBeNull();

      const done = await verify(first.body.challengeToken, { code: codeNow(mfa) }).expect(200);
      expect(done.body).toMatchObject({ step: 'SELECT_ORGANIZATION', selectionToken: expect.any(String), organizations: [expect.objectContaining({ tenantId: tenant.tenantId })] });
      expect((await lastLoginAt(user.userId))).not.toBeNull();

      const session = await select(done.body.selectionToken).expect(200);
      await http().get('/auth/me').set(bearer(session.body.accessToken)).expect(200);
      const { rows } = await db.platform.query<{ mfa_verified: boolean }>('SELECT mfa_verified FROM refresh_sessions WHERE user_id = $1', [user.userId]);
      expect(rows).toEqual([{ mfa_verified: true }]);
    });

    it('a wrong code answers 401 INVALID_MFA_CODE and the challenge stays usable', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      const wrong = await verify(challenge, { code: '000000' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_MFA_CODE');
      await verify(challenge, { code: codeNow(mfa) }).expect(200);
    });

    it('a code works once: the same code at the next login is refused, the next step works', async () => {
      const { user, mfa } = await userWithMfa();
      await verify(await challengeOf(user.email), { code: codeNow(mfa) }).expect(200);
      await verify(await challengeOf(user.email), { code: codeNow(mfa) }).expect(401);
      clock.advanceSeconds(30);
      await verify(await challengeOf(user.email), { code: codeNow(mfa) }).expect(200);
    });

    it('accepts the code of the previous step and refuses the one from two steps ago', async () => {
      const { user, mfa } = await userWithMfa();
      await verify(await challengeOf(user.email), { code: codeNow(mfa, -2) }).expect(401);
      await verify(await challengeOf(user.email), { code: codeNow(mfa, -1) }).expect(200);
    });

    it('five wrong codes lock the second factor: even the right code is refused afterwards', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      for (let attempt = 0; attempt < 5; attempt += 1) await verify(challenge, { code: '000000' }).expect(401);
      const locked = await verify(challenge, { code: codeNow(mfa) }).expect(401);
      expect(locked.body.error.code).toBe('INVALID_MFA_CODE');
      expect((await db.owner.query<{ mfa_failed_attempts: number }>('SELECT mfa_failed_attempts FROM users WHERE id = $1', [user.userId])).rows[0]?.mfa_failed_attempts).toBe(5);
    });

    it('a burst of parallel wrong codes counts exactly five attempts', async () => {
      const { user } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      const responses = await Promise.all(Array.from({ length: 12 }, () => verify(challenge, { code: '000000' })));
      expect(responses.every((response) => response.status === 401)).toBe(true);
      expect((await db.owner.query<{ mfa_failed_attempts: number }>('SELECT mfa_failed_attempts FROM users WHERE id = $1', [user.userId])).rows[0]?.mfa_failed_attempts).toBe(5);
    });

    it('a backup code works once and says how many are left', async () => {
      const { user, mfa } = await userWithMfa();
      const used = await verify(await challengeOf(user.email), { backupCode: mfa.backupCodes[0]!.toLowerCase() }).expect(200);
      expect(used.body.backupCodesLeft).toBe(9);
      await verify(await challengeOf(user.email), { backupCode: mfa.backupCodes[0] }).expect(401);
      const next = await verify(await challengeOf(user.email), { backupCode: mfa.backupCodes[1] }).expect(200);
      expect(next.body.backupCodesLeft).toBe(8);
    });

    it('the challenge works once', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      await verify(challenge, { code: codeNow(mfa) }).expect(200);
      clock.advanceSeconds(30);
      const again = await verify(challenge, { code: codeNow(mfa) }).expect(401);
      expect(again.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('the challenge is not a selection token, an access token or a platform token, and they are not challenges', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      await select(challenge).expect(401);
      await http().get('/auth/me').set(bearer(challenge)).expect(401);
      await http().post('/auth/platform/select').set(bearer(challenge)).expect(401);
      const selection = await app.get(JwtTokenService).issueSelectionToken(user.userId, { mfa: true });
      await verify(selection.token, { code: codeNow(mfa) }).expect(401);
    });

    it('a challenge issued before a password change is refused', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      await db.platform.query('UPDATE users SET password_changed_at = $2 WHERE id = $1', [user.userId, clock.now()]);
      await verify(challenge, { code: codeNow(mfa) }).expect(401);
    });

    it('needs the challenge: no token, garbage or an expired one', async () => {
      await http().post('/auth/login/mfa').send({ code: '123456' }).expect(401);
      await verify('garbage', { code: '123456' }).expect(401);
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      clock.advanceSeconds(5 * 60 + 10);
      await verify(challenge, { code: codeNow(mfa) }).expect(401);
    });

    it('rejects a malformed code and a request with both factors', async () => {
      const { user } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      await verify(challenge, { code: '12345' }).expect(400);
      await verify(challenge, { code: '123456', backupCode: 'ABCD-EFGH-JKMN-PQRS' }).expect(400);
      await verify(challenge, {}).expect(400);
    });

    it('a wrong password never reveals whether the account has MFA', async () => {
      const { user } = await userWithMfa();
      const wrong = await login(user.email, 'wrong password').expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('forced enrollment', () => {
    it('a platform administrator without MFA enrolls at login and can then open a platform session', async () => {
      const admin = await seedPlatformAdmin(db);
      await db.owner.query(`UPDATE users SET mfa_enabled = false, mfa_enabled_at = NULL, mfa_secret_encrypted = NULL, mfa_last_step = NULL WHERE id = $1`, [admin.userId]);
      await db.owner.query('DELETE FROM user_mfa_backup_codes WHERE user_id = $1', [admin.userId]);

      const first = await login(admin.email, admin.password).expect(200);
      expect(first.body).toMatchObject({ step: 'MFA_ENROLLMENT_REQUIRED', reason: 'PLATFORM_ADMIN' });
      const challenge = first.body.challengeToken as string;

      const begun = await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200);
      expect(begun.body).toMatchObject({ issuer: 'ProcesaBPM', accountName: admin.email, algorithm: 'SHA1', digits: 6, period: 30 });
      expect(begun.body.otpauthUri).toContain(`secret=${begun.body.secret}`);
      const secret = base32Decode(begun.body.secret as string);

      await http().post('/auth/login/mfa/enrollment/confirm').set(bearer(challenge)).send({ code: '000000' }).expect(401);
      const confirmed = await http().post('/auth/login/mfa/enrollment/confirm').set(bearer(challenge)).send({ code: currentCode(secret, 0, clock.now().getTime()) }).expect(200);
      expect(confirmed.body.backupCodes).toHaveLength(10);
      expect(new Set(confirmed.body.backupCodes).size).toBe(10);
      expect(confirmed.body).toMatchObject({ step: 'SELECT_ORGANIZATION', platformAdmin: true });
      expect((await db.owner.query<{ mfa_enabled: boolean }>('SELECT mfa_enabled FROM users WHERE id = $1', [admin.userId])).rows[0]?.mfa_enabled).toBe(true);

      await http().post('/auth/platform/select').set(bearer(confirmed.body.selectionToken)).expect(200);
    });

    it('the secret is stored encrypted, never in clear text', async () => {
      const user = await seedUser(db, tenant);
      await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [user.userId]);
      const challenge = (await login(user.email).expect(200)).body.challengeToken as string;
      const begun = await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200);
      const stored = (await db.owner.query<{ mfa_secret_encrypted: Buffer }>('SELECT mfa_secret_encrypted FROM users WHERE id = $1', [user.userId])).rows[0]!.mfa_secret_encrypted;
      expect(stored.includes(base32Decode(begun.body.secret as string))).toBe(false);
      expect(stored[0]).toBe(1);
    });

    it('enrollment endpoints refuse a verification challenge and the other way round', async () => {
      const { user, mfa } = await userWithMfa();
      const challenge = await challengeOf(user.email);
      await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(401);
      const admin = await seedUser(db, tenant);
      await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [admin.userId]);
      const enrollChallenge = (await login(admin.email).expect(200)).body.challengeToken as string;
      await verify(enrollChallenge, { code: codeNow(mfa) }).expect(401);
    });

    it('enrollment is refused when MFA is already on', async () => {
      const { user } = await userWithMfa();
      const enroll = await app.get(JwtTokenService).issueMfaChallenge(user.userId, 'ENROLL');
      const response = await http().post('/auth/login/mfa/enrollment').set(bearer(enroll.token)).expect(409);
      expect(response.body.error.code).toBe('MFA_ALREADY_ENABLED');
    });

    it('a user in no policy and no platform role is not asked to enroll', async () => {
      const user = await seedUser(db, tenant);
      expect((await login(user.email).expect(200)).body.step).toBe('SELECT_ORGANIZATION');
    });
  });

  describe('platform sessions', () => {
    it('refuse a selection token that was issued without the second factor', async () => {
      const admin = await seedPlatformAdmin(db);
      const withoutMfa = await app.get(JwtTokenService).issueSelectionToken(admin.userId, { mfa: false });
      const response = await http().post('/auth/platform/select').set(bearer(withoutMfa.token)).expect(403);
      expect(response.body.error.code).toBe('MFA_REQUIRED');
      const withMfa = await app.get(JwtTokenService).issueSelectionToken(admin.userId, { mfa: true });
      await http().post('/auth/platform/select').set(bearer(withMfa.token)).expect(200);
    });
  });
});
