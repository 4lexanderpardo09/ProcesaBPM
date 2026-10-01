import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { loginResponseSchema } from '@procesabpm/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD } from '../support/auth-helpers.js';
import { addMembership, seedUser, type TestUser, userRow } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('POST /auth/login', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  /** Everything the client can observe, except the request id. */
  const observable = (response: request.Response) => ({
    status: response.status,
    body: { error: { ...response.body.error, requestId: undefined } },
    setCookie: response.headers['set-cookie'],
  });

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('returns the organizations and a short-lived selection token', async () => {
    const user = await seedUser(db, tenant);
    const response = await login(user.email, user.password).expect(200);
    const body = loginResponseSchema.parse(response.body);
    expect(body.organizations).toEqual([
      expect.objectContaining({ tenantId: tenant.tenantId, membershipStatus: 'ACTIVE' }),
    ]);
    expect(body.expiresIn).toBe(120);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('accepts the e-mail in any case and with spaces', async () => {
    const user = await seedUser(db, tenant);
    await login(`  ${user.email.toUpperCase()} `, user.password).expect(200);
  });

  describe('failures are indistinguishable', () => {
    let wrongPassword: request.Response;
    let unknownUser: request.Response;
    let lockedUser: request.Response;
    let disabledUser: request.Response;
    let userWithoutPassword: request.Response;

    beforeAll(async () => {
      const user = await seedUser(db, tenant);
      wrongPassword = await login(user.email, 'not the right password');

      unknownUser = await login(`nobody-${Date.now()}@example.com`, TEST_PASSWORD);

      const locked = await seedUser(db, tenant);
      await db.platform.query(`UPDATE users SET locked_until = now() + interval '10 minutes' WHERE id = $1`, [locked.userId]);
      lockedUser = await login(locked.email, locked.password);

      const disabled = await seedUser(db, tenant);
      await db.platform.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [disabled.userId]);
      disabledUser = await login(disabled.email, disabled.password);

      const noPassword = await seedUser(db, tenant);
      await db.platform.query('UPDATE users SET password_hash = NULL WHERE id = $1', [noPassword.userId]);
      userWithoutPassword = await login(noPassword.email, TEST_PASSWORD);
    });

    it('answers 401 INVALID_CREDENTIALS', () => {
      expect(observable(wrongPassword)).toEqual({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials', requestId: undefined } },
        setCookie: undefined,
      });
    });

    it.each([
      ['an unknown e-mail', () => unknownUser],
      ['a locked account with the right password', () => lockedUser],
      ['a disabled account with the right password', () => disabledUser],
      ['an account without a password', () => userWithoutPassword],
    ])('%s looks exactly like a wrong password', (_label, response) => {
      expect(observable(response())).toEqual(observable(wrongPassword));
    });
  });

  describe('lockout (5 failures, 15 minutes)', () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await seedUser(db, tenant);
      for (let attempt = 0; attempt < 5; attempt += 1) await login(user.email, 'wrong password').expect(401);
    });

    it('locks the account for 15 minutes after 5 failures in a row', async () => {
      const row = await userRow(db, user.userId);
      expect(row.failed_logins).toBe(5);
      const minutesLeft = (row.locked_until!.getTime() - Date.now()) / 60_000;
      expect(minutesLeft).toBeGreaterThan(14);
      expect(minutesLeft).toBeLessThanOrEqual(15);
    });

    it('rejects even the right password while locked, without extending the lockout', async () => {
      const before = await userRow(db, user.userId);
      await login(user.email, user.password).expect(401);
      await login(user.email, 'wrong again').expect(401);
      const after = await userRow(db, user.userId);
      expect(after.locked_until).toEqual(before.locked_until);
      expect(after.failed_logins).toBe(before.failed_logins);
    });

    it('lets the right password in once the lockout is over, and resets the counter', async () => {
      await db.platform.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [user.userId]);
      await login(user.email, user.password).expect(200);
      expect(await userRow(db, user.userId)).toMatchObject({ failed_logins: 0, locked_until: null });
    });
  });

  it('a successful login resets the failure counter before it locks', async () => {
    const user = await seedUser(db, tenant);
    for (let attempt = 0; attempt < 4; attempt += 1) await login(user.email, 'wrong password').expect(401);
    await login(user.email, user.password).expect(200);
    for (let attempt = 0; attempt < 4; attempt += 1) await login(user.email, 'wrong password').expect(401);
    expect(await userRow(db, user.userId)).toMatchObject({ failed_logins: 4, locked_until: null });
  });

  it('answers 501 MFA_NOT_IMPLEMENTED only after the right password of an MFA user', async () => {
    const user = await seedUser(db, tenant);
    await db.platform.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [user.userId]);
    const right = await login(user.email, user.password).expect(501);
    expect(right.body.error.code).toBe('MFA_NOT_IMPLEMENTED');
    const wrong = await login(user.email, 'wrong password').expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('lists only the organizations where the membership is not inactive', async () => {
    const user = await seedUser(db, tenant);
    const other = await seedTenant(db.platform);
    await addMembership(db, other, user.userId);
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [
      other.tenantId,
      user.userId,
    ]);
    const response = await login(user.email, user.password).expect(200);
    expect(response.body.organizations.map((organization: { tenantId: string }) => organization.tenantId)).toEqual([
      tenant.tenantId,
    ]);
  });
});
