import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedDraftWorkflow, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { TenantProbeController } from '../support/test-controllers.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('HTTP API', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let logLines: string[];
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    ({ app, logLines } = await createTestApp([TenantProbeController]));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const asTenant = (tenant: SeededTenant) => ({ 'x-tenant-id': tenant.tenantId, 'x-user-id': tenant.userId });

  describe('health', () => {
    it('GET /health answers while the process is alive', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('GET /ready answers when the database is reachable', async () => {
      const response = await request(app.getHttpServer()).get('/ready').expect(200);
      expect(response.body).toEqual({ status: 'ready' });
    });

    it('GET /ready answers 503 when the database is not reachable', async () => {
      const unreachable = 'postgresql://nobody:none@127.0.0.1:1/none';
      const original = process.env.DATABASE_URL;
      process.env.DATABASE_URL = unreachable;
      const { app: brokenApp } = await createTestApp();
      process.env.DATABASE_URL = original;
      try {
        const response = await request(brokenApp.getHttpServer()).get('/ready').expect(503);
        expect(response.body.error.code).toBe('HTTP_503');
      } finally {
        await brokenApp.close();
      }
    });
  });

  describe('request id', () => {
    it('generates one and returns it in the header', async () => {
      const response = await request(app.getHttpServer()).get('/health');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('keeps the id sent by the caller', async () => {
      const response = await request(app.getHttpServer()).get('/health').set('x-request-id', 'trace-42');
      expect(response.headers['x-request-id']).toBe('trace-42');
    });
  });

  describe('tenant isolation over HTTP (tenant leak test)', () => {
    it('each tenant only sees its own companies', async () => {
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).get('/test/companies').set(asTenant(tenantA)).expect(200),
        request(app.getHttpServer()).get('/test/companies').set(asTenant(tenantB)).expect(200),
      ]);
      expect(a.body.map((row: { tenantId: string }) => row.tenantId)).toEqual([tenantA.tenantId]);
      expect(b.body.map((row: { tenantId: string }) => row.tenantId)).toEqual([tenantB.tenantId]);
    });

    it('a request without tenant context is refused with a generic 500, never answered with data', async () => {
      const response = await request(app.getHttpServer()).get('/test/companies').expect(500);
      expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
      expect(JSON.stringify(response.body)).not.toContain(tenantA.tenantId);
      const logged = logLines.map((line) => JSON.parse(line) as { request_id?: string; message: string });
      expect(logged.some((entry) => entry.request_id === response.body.error.requestId)).toBe(true);
    });
  });

  describe('error translation', () => {
    it('answers a database trigger violation (23514) with 422 and no database text', async () => {
      const workflow = await seedDraftWorkflow(db.platform, tenantA);
      const response = await request(app.getHttpServer())
        .get('/test/invalid-step-change')
        .set({ ...asTenant(tenantA), 'x-step-id': workflow.startStepId })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
      expect(JSON.stringify(response.body)).not.toMatch(/steps|trigger|relation/i);
    });
  });
});
