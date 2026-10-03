import type { INestApplication } from '@nestjs/common';
import { createPlatformAdmin } from '@procesabpm/db/seed/platform-admin';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { bearer } from '../support/auth-helpers.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode } from '../support/mfa-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

const NEW_PASSWORD = 'a password chosen from the link 42';

describe('first platform admin created by the command line', () => {
  let db: TestDatabase;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('sets the password with the link, must enroll MFA at the first login, then provisions a tenant', async () => {
    await db.owner.query('DELETE FROM platform_admins');
    const email = `bootstrap-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const client = await db.platform.connect();
    const created = await createPlatformAdmin(client, { email, firstName: 'Ada', lastName: 'Root', forceAdditional: false, webBaseUrl: 'https://app.example.com' }).finally(() => client.release());
    const token = decodeURIComponent(new URL(created.setPasswordLink!).hash.replace('#token=', ''));

    // Not usable before the password is chosen.
    await http().post('/auth/login').send({ email, password: NEW_PASSWORD }).expect(401);

    await http().post('/auth/password-reset/confirm').send({ token, newPassword: NEW_PASSWORD }).expect(204);
    await http().post('/auth/password-reset/confirm').send({ token, newPassword: NEW_PASSWORD }).expect(400);

    // Tokens carry second-resolution timestamps: wait out the instant the password changed.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const login = await http().post('/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
    expect(login.body.step).toBe('MFA_ENROLLMENT_REQUIRED');
    const challenge = login.body.challengeToken as string;

    const begun = await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200);
    const confirmed = await http()
      .post('/auth/login/mfa/enrollment/confirm')
      .set(bearer(challenge))
      .send({ code: currentCode(base32Decode(begun.body.secret as string)) })
      .expect(200);

    const session = await http().post('/auth/platform/select').set(bearer(confirmed.body.selectionToken as string)).expect(200);
    const accessToken = session.body.accessToken as string;

    const owner = `owner-${Math.random().toString(36).slice(2, 10)}@example.com`;
    const tenant = await http()
      .post('/platform/tenants')
      .set(bearer(accessToken))
      .send({ slug: `boot-${Math.random().toString(36).slice(2, 10)}`, name: 'Bootstrap Corp', planCode: 'professional', countryCode: 'CO', owner: { email: owner, firstName: 'Olga', lastName: 'Owner' } });
    expect(tenant.status, JSON.stringify(tenant.body)).toBe(201);
  });
});
