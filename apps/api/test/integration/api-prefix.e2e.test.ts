import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { API_PREFIX, AUTH_COOKIE_PATH } from '@procesabpm/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedUser } from '../support/auth-fixtures.js';
import { refreshSetCookieOf } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

/** The application exactly as production serves it (no test prefix shim): every route under /api, the cookie scoped to it. */
describe('API prefix', () => {
  let db: TestDatabase;
  let app: INestApplication;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp({ addPrefix: false }));
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const http = () => request(app.getHttpServer());

  it('is /api', () => {
    expect(API_PREFIX).toBe('/api');
    expect(AUTH_COOKIE_PATH).toBe('/api/auth');
  });

  it('serves the health checks under the prefix, and nothing without it', async () => {
    expect((await http().get('/api/health').expect(200)).body).toMatchObject({ status: 'ok' });
    await http().get('/api/ready').expect(200);
    await http().get('/health').expect(404);
    await http().post('/auth/login').send({ email: 'nobody@example.com', password: 'x' }).expect(404);
  });

  it('signs in under the prefix and scopes the refresh cookie to /api/auth', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const login = await http().post('/api/auth/login').send({ email: user.email, password: user.password }).expect(200);
    const session = await http().post('/api/auth/select-tenant').set('authorization', `Bearer ${login.body.selectionToken as string}`).send({ tenantId: tenant.tenantId }).expect(200);
    const setCookie = refreshSetCookieOf(session)!;
    expect(setCookie).toContain('Path=/api/auth;');
    const cookie = setCookie.split(';')[0]!;
    const refreshed = await http().post('/api/auth/refresh').set('cookie', cookie).expect(200);
    await http().get('/api/auth/me').set('authorization', `Bearer ${refreshed.body.accessToken as string}`).expect(200);
  });
});
