import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { bearer } from './auth-helpers.js';
import { seedUser, type TestUser } from './auth-fixtures.js';
import { enableMfa, logInWithMfa } from './mfa-fixtures.js';

export interface VerifiedAdmin {
  readonly user: TestUser;
  readonly accessToken: string;
}

/** A member of the tenant (admin role: the fixtures grant `manage all`) whose session passed the second factor. */
export async function verifiedAdminOf(app: INestApplication, db: TestDatabase, tenant: SeededTenant): Promise<VerifiedAdmin> {
  const user = await seedUser(db, tenant);
  const mfa = await enableMfa(db, user.userId);
  const selection = await logInWithMfa(app, db, user, mfa);
  const session = await request(app.getHttpServer()).post('/auth/select-tenant').set(bearer(selection)).send({ tenantId: tenant.tenantId }).expect(200);
  return { user, accessToken: session.body.accessToken as string };
}

export const grantSupport = (app: INestApplication, adminToken: string, body: object = { reason: 'Investigating a stuck ticket' }) =>
  request(app.getHttpServer()).post('/settings/support-access').set(bearer(adminToken)).send(body);

export const revokeSupport = (app: INestApplication, adminToken: string) =>
  request(app.getHttpServer()).delete('/settings/support-access').set(bearer(adminToken));

export const openSupportSession = (app: INestApplication, platformToken: string, tenantId: string) =>
  request(app.getHttpServer()).post(`/platform/tenants/${tenantId}/support-sessions`).set(bearer(platformToken));
