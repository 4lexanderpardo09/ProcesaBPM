import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, logIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { logInWithMfa } from '../support/mfa-fixtures.js';
import { seedPlatformAdmin } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('the selection token works once and dies with a password change', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;

  const select = (token: string) => request(app.getHttpServer()).post('/auth/select-tenant').set(bearer(token)).send({ tenantId: tenant.tenantId });
  const selectPlatform = (token: string) => request(app.getHttpServer()).post('/auth/platform/select').set(bearer(token));
  const changePasswordNow = (userId: string) => db.platform.query('UPDATE users SET password_changed_at = now() WHERE id = $1', [userId]);

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('a second selection with the same token is refused', async () => {
    const user = await seedUser(db, tenant);
    const token = await logIn(app, user.email);
    await select(token).expect(200);
    const again = await select(token).expect(401);
    expect(again.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('of ten parallel selections with the same token exactly one opens a session', async () => {
    const user = await seedUser(db, tenant);
    const token = await logIn(app, user.email);
    const responses = await Promise.all(Array.from({ length: 10 }, () => select(token)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(9);
    const sessions = await db.platform.query('SELECT 1 FROM refresh_sessions WHERE user_id = $1', [user.userId]);
    expect(sessions.rowCount).toBe(1);
  });

  it('a selection refused for another reason does not burn the token', async () => {
    const user = await seedUser(db, tenant);
    const other = await seedTenant(db.platform);
    const token = await logIn(app, user.email);
    await request(app.getHttpServer()).post('/auth/select-tenant').set(bearer(token)).send({ tenantId: other.tenantId }).expect(401);
    await select(token).expect(200);
  });

  it('a token issued before a password change is refused', async () => {
    const user = await seedUser(db, tenant);
    const token = await logIn(app, user.email);
    await changePasswordNow(user.userId);
    await select(token).expect(401);
    expect((await db.platform.query('SELECT 1 FROM refresh_sessions WHERE user_id = $1', [user.userId])).rowCount).toBe(0);
  });

  it('the platform session works once too, and not after a password change', async () => {
    const admin = await seedPlatformAdmin(db);
    const token = await logInWithMfa(app, db, admin, admin.mfa);
    await selectPlatform(token).expect(200);
    await selectPlatform(token).expect(401);

    const stale = await logInWithMfa(app, db, admin, admin.mfa);
    await changePasswordNow(admin.userId);
    await selectPlatform(stale).expect(401);
  });

  it('a user that is not a platform administrator does not burn the token by asking for a platform session', async () => {
    const user = await seedUser(db, tenant);
    const token = await logIn(app, user.email);
    await selectPlatform(token).expect(403);
    await select(token).expect(200);
  });
});
