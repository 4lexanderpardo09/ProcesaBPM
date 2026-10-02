import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, logIn, signIn } from '../support/auth-helpers.js';
import { seedUser, userRow } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const NEW_PASSWORD = 'a brand new passphrase';

describe('POST /auth/password', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;

  const change = (accessToken: string | undefined, body: object) => {
    const call = request(app.getHttpServer()).post('/auth/password').send(body);
    return accessToken === undefined ? call : call.set(bearer(accessToken));
  };
  const refresh = (cookie: string) => request(app.getHttpServer()).post('/auth/refresh').set('cookie', cookie);
  const me = (accessToken: string) => request(app.getHttpServer()).get('/auth/me').set(bearer(accessToken));

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('needs a signed-in user', async () => {
    await change(undefined, { currentPassword: 'x', newPassword: NEW_PASSWORD }).expect(401);
  });

  it('changes the password, keeps the calling session and revokes the others', async () => {
    const user = await seedUser(db, tenant);
    const current = await signIn(app, user.email, tenant.tenantId);
    const other = await signIn(app, user.email, tenant.tenantId);

    await change(current.accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(204);

    await me(current.accessToken).expect(200);
    await refresh(current.refreshCookie).expect(200);
    await refresh(other.refreshCookie).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: user.password }).expect(401);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await logIn(app, user.email, NEW_PASSWORD);
  });

  it('a selection token issued before the change no longer opens a session', async () => {
    const user = await seedUser(db, tenant);
    const session = await signIn(app, user.email, tenant.tenantId);
    const staleSelection = await logIn(app, user.email);
    await change(session.accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(204);
    await request(app.getHttpServer()).post('/auth/select-tenant').set(bearer(staleSelection)).send({ tenantId: tenant.tenantId }).expect(401);
  });

  it('a wrong current password answers 401 INVALID_CREDENTIALS, changes nothing and counts as a failed attempt', async () => {
    const user = await seedUser(db, tenant);
    const session = await signIn(app, user.email, tenant.tenantId);
    const before = await userRow(db, user.userId);
    const response = await change(session.accessToken, { currentPassword: 'not the password', newPassword: NEW_PASSWORD }).expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    const after = await userRow(db, user.userId);
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.failed_logins).toBe(1);
    await me(session.accessToken).expect(200);
  });

  it('five wrong guesses lock the account, so a stolen access token cannot brute-force the password', async () => {
    const user = await seedUser(db, tenant);
    const session = await signIn(app, user.email, tenant.tenantId);
    for (let i = 0; i < 5; i += 1) await change(session.accessToken, { currentPassword: `guess ${i}`, newPassword: NEW_PASSWORD }).expect(401);
    await change(session.accessToken, { currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(401);
    expect((await userRow(db, user.userId)).locked_until).not.toBeNull();
  });

  it('applies the password policy to the new password', async () => {
    const user = await seedUser(db, tenant);
    const session = await signIn(app, user.email, tenant.tenantId);
    await change(session.accessToken, { currentPassword: user.password, newPassword: 'short' }).expect(400);
  });
});
