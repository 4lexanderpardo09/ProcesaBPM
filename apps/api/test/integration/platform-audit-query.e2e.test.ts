import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform, type PlatformAdminUser } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('platform console: audit log', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let admin: PlatformAdminUser;
  let token: string;
  const http = () => request(app.getHttpServer());
  const query = (qs: string) => http().get(`/platform/audit-logs${qs}`).set(bearer(token));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    admin = await seedPlatformAdmin(db);
    token = await signInPlatform(app, db, admin);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('shows what administrators did, newest first, filtered by actor, tenant, action and dates', async () => {
    const tenant = await seedTenant(db.platform);
    const other = await seedTenant(db.platform);
    await http().post(`/platform/tenants/${tenant.tenantId}/suspend`).set(bearer(token)).send({ reason: 'Unpaid invoice' }).expect(200);
    await http().post(`/platform/tenants/${tenant.tenantId}/reactivate`).set(bearer(token)).send({}).expect(200);
    await http().post(`/platform/tenants/${other.tenantId}/suspend`).set(bearer(token)).send({ reason: 'Abuse' }).expect(200);

    const byTenant = await query(`?tenantId=${tenant.tenantId}`).expect(200);
    expect(byTenant.body.items.map((entry: { action: string }) => entry.action)).toEqual(['tenant.reactivated', 'tenant.suspended']);
    expect(byTenant.body.items[1]).toMatchObject({ actorUserId: admin.userId, targetTenantId: tenant.tenantId, data: { reason: 'Unpaid invoice' }, ipAddress: expect.any(String) });
    expect(byTenant.body.total).toBe(2);

    const byAction = await query(`?actorUserId=${admin.userId}&action=tenant.suspended`).expect(200);
    expect(byAction.body.items.every((entry: { action: string; actorUserId: string }) => entry.action === 'tenant.suspended' && entry.actorUserId === admin.userId)).toBe(true);
    expect(byAction.body.items.map((entry: { targetTenantId: string }) => entry.targetTenantId)).toEqual([other.tenantId, tenant.tenantId]);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect((await query(`?tenantId=${tenant.tenantId}&from=${encodeURIComponent(future)}`).expect(200)).body.items).toEqual([]);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect((await query(`?tenantId=${tenant.tenantId}&from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}`).expect(200)).body.total).toBe(2);
  });

  it('paginates', async () => {
    const page = await query('?pageSize=1&page=2').expect(200);
    expect(page.body).toMatchObject({ page: 2, pageSize: 1 });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBeGreaterThan(1);
  });

  it('refuses malformed filters', async () => {
    await query('?actorUserId=nope').expect(400);
    await query('?from=yesterday').expect(400);
    await query(`?from=${encodeURIComponent('2030-01-02T00:00:00Z')}&to=${encodeURIComponent('2030-01-01T00:00:00Z')}`).expect(400);
    await query('?pageSize=500').expect(400);
  });

  it('can be filtered by an actor without entries', async () => {
    expect((await query(`?actorUserId=${randomUUID()}`).expect(200)).body).toMatchObject({ items: [], total: 0 });
  });

  it('a tenant user gets 403 and no token gets 401', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await http().get('/platform/audit-logs').set(bearer(accessToken)).expect(403);
    await http().get('/platform/audit-logs').expect(401);
  });
});
