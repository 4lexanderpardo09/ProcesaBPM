import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import request from 'supertest';
import { expect } from 'vitest';
import { PasswordHasher } from '../../src/infrastructure/security/password-hasher.js';
import { REFRESH_COOKIE_NAME } from '../../src/modules/auth/http/refresh-cookie.js';

export const TEST_PASSWORD = 'correct horse battery staple';

const hasher = new PasswordHasher();

export async function setPassword(db: TestDatabase, userId: string, password = TEST_PASSWORD): Promise<void> {
  await db.platform.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hasher.hash(password), userId]);
}

export async function emailOf(db: TestDatabase, userId: string): Promise<string> {
  const { rows } = await db.platform.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
  return rows[0]!.email;
}

export { REFRESH_COOKIE_NAME };

/** The refresh cookie line of a response, if any. */
export function refreshSetCookieOf(response: request.Response): string | undefined {
  return ([] as string[]).concat(response.headers['set-cookie'] ?? []).find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

/** The `name=value` pair of the refresh cookie, ready to send back as a Cookie header. */
export function refreshCookieOf(response: request.Response): string | undefined {
  const pair = refreshSetCookieOf(response)?.split(';')[0];
  return pair === `${REFRESH_COOKIE_NAME}=` ? undefined : pair;
}

export interface SignedIn {
  readonly accessToken: string;
  readonly refreshCookie: string;
}

export async function logIn(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200);
  return response.body.selectionToken as string;
}

export async function signIn(app: INestApplication, email: string, tenantId: string, password = TEST_PASSWORD): Promise<SignedIn> {
  const selectionToken = await logIn(app, email, password);
  const response = await request(app.getHttpServer())
    .post('/auth/select-tenant')
    .set('authorization', `Bearer ${selectionToken}`)
    .send({ tenantId })
    .expect(200);
  const refreshCookie = refreshCookieOf(response);
  expect(refreshCookie).toBeDefined();
  return { accessToken: response.body.accessToken as string, refreshCookie: refreshCookie! };
}

export const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });
