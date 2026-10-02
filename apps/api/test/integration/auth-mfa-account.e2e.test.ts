import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { bearer, refreshCookieOf, signIn } from '../support/auth-helpers.js';
import { seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, logInWithMfa, type MfaCredentials } from '../support/mfa-fixtures.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('two-step verification from the account', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  const clock = new TestClock(new Date());

  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'post', path: string, accessToken: string, body?: object) => http()[method](path).set(bearer(accessToken)).send(body);
  const codeNow = (secret: Buffer, stepOffset = 0) => currentCode(secret, stepOffset, clock.now().getTime());

  /** A tenant session of a user (with the second factor already on when `withMfa`). */
  async function sessionOf(withMfa: boolean) {
    const user: TestUser = await seedUser(db, tenant);
    const mfa = withMfa ? await enableMfa(db, user.userId) : undefined;
    const sign = async () => {
      if (mfa === undefined) return signIn(app, user.email, tenant.tenantId);
      const selection = await logInWithMfa(app, db, user, mfa, clock.now().getTime());
      const response = await http().post('/auth/select-tenant').set(bearer(selection)).send({ tenantId: tenant.tenantId }).expect(200);
      return { accessToken: response.body.accessToken as string, refreshCookie: refreshCookieOf(response)! };
    };
    return { user, mfa, session: await sign(), sign };
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

  it('needs a signed-in user', async () => {
    await http().get('/auth/mfa').expect(401);
    await http().post('/auth/mfa/enrollment').expect(401);
  });

  describe('enrolling', () => {
    it('shows the app data, turns MFA on with the first code, hands out ten backup codes once and signs the other sessions out', async () => {
      const { user, session, sign } = await sessionOf(false);
      const other = await sign();
      expect((await call('get', '/auth/mfa', session.accessToken).expect(200)).body).toEqual({ enabled: false, enabledAt: null, backupCodesLeft: 0, requiredByPolicy: false });

      const begun = await call('post', '/auth/mfa/enrollment', session.accessToken).expect(200);
      expect(begun.body).toMatchObject({ issuer: 'ProcesaBPM', accountName: user.email, algorithm: 'SHA1', digits: 6, period: 30 });
      const secret = base32Decode(begun.body.secret as string);

      const wrong = await call('post', '/auth/mfa/enrollment/confirm', session.accessToken, { code: '000000' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_MFA_CODE');
      const confirmed = await call('post', '/auth/mfa/enrollment/confirm', session.accessToken, { code: codeNow(secret) }).expect(200);
      expect(confirmed.body.backupCodes).toHaveLength(10);

      const status = (await call('get', '/auth/mfa', session.accessToken).expect(200)).body;
      expect(status).toMatchObject({ enabled: true, backupCodesLeft: 10, requiredByPolicy: false });
      await call('get', '/auth/me', session.accessToken).expect(200);
      await http().post('/auth/refresh').set('cookie', other.refreshCookie).expect(401);
      const { rows } = await db.platform.query<{ mfa_verified: boolean }>('SELECT mfa_verified FROM refresh_sessions WHERE user_id = $1 AND revoked_at IS NULL', [user.userId]);
      expect(rows).toEqual([{ mfa_verified: true }]);
    });

    it('starting over replaces the pending secret: the first one no longer confirms', async () => {
      const { session } = await sessionOf(false);
      const first = base32Decode((await call('post', '/auth/mfa/enrollment', session.accessToken).expect(200)).body.secret as string);
      const second = base32Decode((await call('post', '/auth/mfa/enrollment', session.accessToken).expect(200)).body.secret as string);
      await call('post', '/auth/mfa/enrollment/confirm', session.accessToken, { code: codeNow(first) }).expect(401);
      clock.advanceSeconds(30);
      await call('post', '/auth/mfa/enrollment/confirm', session.accessToken, { code: codeNow(second) }).expect(200);
    });

    it('is refused when MFA is already on', async () => {
      const { session } = await sessionOf(true);
      const response = await call('post', '/auth/mfa/enrollment', session.accessToken).expect(409);
      expect(response.body.error.code).toBe('MFA_ALREADY_ENABLED');
    });

    it('cannot be confirmed without a pending secret', async () => {
      const { session } = await sessionOf(false);
      await call('post', '/auth/mfa/enrollment/confirm', session.accessToken, { code: '123456' }).expect(401);
    });
  });

  describe('turning it off', () => {
    it('needs the password and a code; afterwards the login goes straight to the organization picker', async () => {
      const { user, mfa, session, sign } = await sessionOf(true);
      const other = await sign();
      const disable = (body: object) => call('post', '/auth/mfa/disable', session.accessToken, body);

      const wrongPassword = await disable({ password: 'not the password', code: codeNow(mfa!.secret) }).expect(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      const wrongCode = await disable({ password: user.password, code: '000000' }).expect(401);
      expect(wrongCode.body.error.code).toBe('INVALID_MFA_CODE');
      await disable({ password: user.password }).expect(400);

      clock.advanceSeconds(30); // the sign-in already used this step
      await disable({ password: user.password, code: codeNow(mfa!.secret) }).expect(204);
      expect((await call('get', '/auth/mfa', session.accessToken).expect(200)).body.enabled).toBe(false);
      await call('get', '/auth/me', session.accessToken).expect(200);
      await http().post('/auth/refresh').set('cookie', other.refreshCookie).expect(401);
      expect((await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200)).body.step).toBe('SELECT_ORGANIZATION');
      const left = await db.owner.query('SELECT 1 FROM user_mfa_backup_codes WHERE user_id = $1', [user.userId]);
      expect(left.rowCount).toBe(0);
    });

    it('also works with a backup code', async () => {
      const { user, mfa, session } = await sessionOf(true);
      await call('post', '/auth/mfa/disable', session.accessToken, { password: user.password, backupCode: mfa!.backupCodes[3] }).expect(204);
    });

    it('is refused when MFA is not on', async () => {
      const { user, session } = await sessionOf(false);
      const response = await call('post', '/auth/mfa/disable', session.accessToken, { password: user.password, code: '123456' }).expect(409);
      expect(response.body.error.code).toBe('MFA_NOT_ENABLED');
    });

    it('is refused for a platform administrator: their second factor is mandatory', async () => {
      const { user, mfa, session } = await sessionOf(true);
      await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [user.userId]);
      const response = await call('post', '/auth/mfa/disable', session.accessToken, { password: user.password, code: codeNow(mfa!.secret) }).expect(422);
      expect(response.body.error.code).toBe('MFA_REQUIRED_BY_POLICY');
      expect((await call('get', '/auth/mfa', session.accessToken).expect(200)).body).toMatchObject({ enabled: true, requiredByPolicy: true });
    });
  });

  describe('backup codes', () => {
    it('are replaced as a whole with a current code; the old ones stop working', async () => {
      const { user, mfa, session } = await sessionOf(true);
      clock.advanceSeconds(30);
      const fresh = await call('post', '/auth/mfa/backup-codes', session.accessToken, { code: codeNow(mfa!.secret) }).expect(200);
      expect(fresh.body.backupCodes).toHaveLength(10);

      const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
      await http().post('/auth/login/mfa').set(bearer(login.body.challengeToken)).send({ backupCode: (mfa as MfaCredentials).backupCodes[0] }).expect(401);
      await http().post('/auth/login/mfa').set(bearer(login.body.challengeToken)).send({ backupCode: fresh.body.backupCodes[0] }).expect(200);
    });

    it('need a valid code and MFA on', async () => {
      const { session: withMfa } = await sessionOf(true);
      await call('post', '/auth/mfa/backup-codes', withMfa.accessToken, { code: '000000' }).expect(401);
      const { session: without } = await sessionOf(false);
      const response = await call('post', '/auth/mfa/backup-codes', without.accessToken, { code: '123456' }).expect(409);
      expect(response.body.error.code).toBe('MFA_NOT_ENABLED');
    });
  });

  it('one user’s second factor is invisible to another user', async () => {
    const first = await sessionOf(true);
    const second = await sessionOf(false);
    expect((await call('get', '/auth/mfa', first.session.accessToken).expect(200)).body.enabled).toBe(true);
    expect((await call('get', '/auth/mfa', second.session.accessToken).expect(200)).body.enabled).toBe(false);
    await call('post', '/auth/mfa/disable', second.session.accessToken, { password: second.user.password, code: codeNow(first.mfa!.secret) }).expect(409);
    expect((await call('get', '/auth/mfa', first.session.accessToken).expect(200)).body.enabled).toBe(true);
  });
});

