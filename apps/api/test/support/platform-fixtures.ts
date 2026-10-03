import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { setPassword, TEST_PASSWORD } from './auth-helpers.js';
import { enableMfa, logInWithMfa, type MfaCredentials } from './mfa-fixtures.js';

export interface PlatformAdminUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly mfa: MfaCredentials;
}

/** A user with a known password, a row in `platform_admins` and MFA on (platform administrators always use it). */
export async function seedPlatformAdmin(db: TestDatabase): Promise<PlatformAdminUser> {
  const email = `platform-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const userId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Platform', 'Admin') RETURNING id`, [email]);
  await setPassword(db, userId);
  await db.platform.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [userId]);
  return { userId, email, password: TEST_PASSWORD, mfa: await enableMfa(db, userId) };
}

/** Login with the second factor followed by `POST /auth/platform/select`; returns the platform access token. */
export async function signInPlatform(app: INestApplication, db: TestDatabase, admin: PlatformAdminUser): Promise<string> {
  const selectionToken = await logInWithMfa(app, db, admin, admin.mfa);
  const response = await request(app.getHttpServer())
    .post('/auth/platform/select')
    .set('authorization', `Bearer ${selectionToken}`)
    .expect(200);
  return response.body.accessToken as string;
}
