import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { logIn, setPassword, TEST_PASSWORD } from './auth-helpers.js';

export interface PlatformAdminUser {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
}

/** A user with a known password and a row in `platform_admins`. */
export async function seedPlatformAdmin(db: TestDatabase): Promise<PlatformAdminUser> {
  const email = `platform-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const userId = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Platform', 'Admin') RETURNING id`, [email]);
  await setPassword(db, userId);
  await db.platform.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [userId]);
  return { userId, email, password: TEST_PASSWORD };
}

/** Login followed by `POST /auth/platform/select`; returns the platform access token. */
export async function signInPlatform(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<string> {
  const selectionToken = await logIn(app, email, password);
  const response = await request(app.getHttpServer())
    .post('/auth/platform/select')
    .set('authorization', `Bearer ${selectionToken}`)
    .expect(200);
  return response.body.accessToken as string;
}
