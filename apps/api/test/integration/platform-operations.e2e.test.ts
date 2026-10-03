import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, seedTicket } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('platform console: operations', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set(bearer(token));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const failedTenantEvent = async (tenantId: string, secret = 'tenant-secret') =>
    (await db.owner.query<{ id: string }>(
      `INSERT INTO outbox_events (tenant_id, type, payload, status, attempts, last_error) VALUES ($1, 'notification.email', $2::jsonb, 'FAILED', 10, 'boom') RETURNING id`,
      [tenantId, JSON.stringify({ secret })],
    )).rows[0]!.id;
  const failedPlatformEvent = async () =>
    (await db.owner.query<{ id: string }>(
      `INSERT INTO platform_outbox_events (type, payload, status, attempts, last_error) VALUES ('email.password_reset', $1::jsonb, 'FAILED', 10, 'smtp down') RETURNING id`,
      [JSON.stringify({ userId: randomUUID(), secret: 'platform-secret' })],
    )).rows[0]!.id;

  describe('failed outbox events', () => {
    it('lists the tenant ones with their tenant and no payload', async () => {
      const tenant = await seedTenant(db.platform);
      const id = await failedTenantEvent(tenant.tenantId);
      const response = await asAdmin(http().get('/platform/operations/outbox-events/failed?scope=TENANT&pageSize=100')).expect(200);
      expect(response.body.items).toContainEqual({ scope: 'TENANT', tenantId: tenant.tenantId, id, type: 'notification.email', attempts: 10, lastError: 'boom', createdAt: expect.any(String) });
      expect(JSON.stringify(response.body)).not.toContain('tenant-secret');
    });

    it('lists the platform ones, without payload', async () => {
      const id = await failedPlatformEvent();
      const response = await asAdmin(http().get('/platform/operations/outbox-events/failed?scope=PLATFORM')).expect(200);
      expect(response.body.items).toContainEqual({ scope: 'PLATFORM', tenantId: null, id, type: 'email.password_reset', attempts: 10, lastError: 'smtp down', createdAt: expect.any(String) });
      expect(JSON.stringify(response.body)).not.toContain('platform-secret');
      expect(response.body.total).toBeGreaterThan(0);
    });

    it('needs a valid scope', async () => {
      await asAdmin(http().get('/platform/operations/outbox-events/failed')).expect(400);
      await asAdmin(http().get('/platform/operations/outbox-events/failed?scope=ALL')).expect(400);
    });

    it('retries a tenant event once and audits it against that tenant', async () => {
      const tenant = await seedTenant(db.platform);
      const other = await seedTenant(db.platform);
      const id = await failedTenantEvent(tenant.tenantId);
      // The id under another tenant does not exist: no cross-tenant retry.
      await asAdmin(http().post(`/platform/operations/outbox-events/tenants/${other.tenantId}/${id}/retry`)).expect(404);

      await asAdmin(http().post(`/platform/operations/outbox-events/tenants/${tenant.tenantId}/${id}/retry`)).expect(204);
      const row = (await db.owner.query(`SELECT status, attempts, last_error FROM outbox_events WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, id])).rows[0];
      expect(row).toEqual({ status: 'PENDING', attempts: 0, last_error: null });
      await asAdmin(http().post(`/platform/operations/outbox-events/tenants/${tenant.tenantId}/${id}/retry`)).expect(404);
      const log = await db.owner.query(`SELECT data FROM platform_audit_logs WHERE action = 'outbox_event.retried' AND target_tenant_id = $1`, [tenant.tenantId]);
      expect(log.rows).toEqual([{ data: { scope: 'TENANT', id } }]);
    });

    it('retries a platform event once', async () => {
      const id = await failedPlatformEvent();
      await asAdmin(http().post(`/platform/operations/outbox-events/platform/${id}/retry`)).expect(204);
      expect((await db.owner.query(`SELECT status FROM platform_outbox_events WHERE id = $1`, [id])).rows[0]).toEqual({ status: 'PENDING' });
      await asAdmin(http().post(`/platform/operations/outbox-events/platform/${id}/retry`)).expect(404);
      await asAdmin(http().post(`/platform/operations/outbox-events/platform/${randomUUID()}/retry`)).expect(404);
    });
  });

  describe('GET /platform/operations/metrics', () => {
    it('reports tenants by status, users, storage and tickets per day', async () => {
      const tenant = await seedTenant(db.platform);
      await seedTicket(db.platform, tenant);
      await db.owner.query(`INSERT INTO tenant_usage (tenant_id, bytes_used) VALUES ($1, 1234) ON CONFLICT (tenant_id) DO UPDATE SET bytes_used = 1234`, [tenant.tenantId]);
      await db.owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [(await seedTenant(db.platform)).tenantId]);

      const { body } = await asAdmin(http().get('/platform/operations/metrics')).expect(200);

      expect(body.tenantsByStatus.ACTIVE).toBeGreaterThan(0);
      expect(body.tenantsByStatus.SUSPENDED).toBeGreaterThan(0);
      expect(body.users.total).toBeGreaterThanOrEqual(body.users.withActiveMembership);
      expect(BigInt(body.storageUsedBytes)).toBeGreaterThanOrEqual(1234n);
      const today = new Date().toISOString().slice(0, 10);
      expect(body.ticketsPerDay.find((day: { date: string }) => day.date === today).count).toBeGreaterThanOrEqual(1);
    });
  });

  it('a tenant user gets 403 and no token gets 401', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await http().get('/platform/operations/metrics').set(bearer(accessToken)).expect(403);
    await http().get('/platform/operations/outbox-events/failed?scope=TENANT').set(bearer(accessToken)).expect(403);
    await http().post(`/platform/operations/outbox-events/platform/${randomUUID()}/retry`).set(bearer(accessToken)).expect(403);
    await http().get('/platform/operations/metrics').expect(401);
  });
});
