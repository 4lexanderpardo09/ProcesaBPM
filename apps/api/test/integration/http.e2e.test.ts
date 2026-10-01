import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedDraftWorkflow, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, emailOf, setPassword, signIn } from '../support/auth-helpers.js';
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
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    ({ app, logLines } = await createTestApp({ controllers: [TenantProbeController] }));
    for (const tenant of [tenantA, tenantB]) await setPassword(db, tenant.userId);
    tokenA = (await signIn(app, await emailOf(db, tenantA.userId), tenantA.tenantId)).accessToken;
    tokenB = (await signIn(app, await emailOf(db, tenantB.userId), tenantB.tenantId)).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('health', () => {
    it('GET /health answers while the process is alive, without a token', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('GET /ready answers when the database is reachable', async () => {
      const response = await request(app.getHttpServer()).get('/ready').expect(200);
      expect(response.body).toEqual({ status: 'ready' });
    });

    it('GET /ready answers 503 when the database is not reachable', async () => {
      const original = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://nobody:none@127.0.0.1:1/none';
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
    it('each token only reaches the companies of its own tenant', async () => {
      const [a, b] = await Promise.all([
        request(app.getHttpServer()).get('/test/companies').set(bearer(tokenA)).expect(200),
        request(app.getHttpServer()).get('/test/companies').set(bearer(tokenB)).expect(200),
      ]);
      expect(a.body.map((row: { tenantId: string }) => row.tenantId)).toEqual([tenantA.tenantId]);
      expect(b.body.map((row: { tenantId: string }) => row.tenantId)).toEqual([tenantB.tenantId]);
    });

    it('a public route has no tenant context: tenant data fails with a generic 500', async () => {
      const response = await request(app.getHttpServer()).get('/test/public-companies').expect(500);
      expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
      expect(JSON.stringify(response.body)).not.toContain(tenantA.tenantId);
      const logged = logLines.map((line) => JSON.parse(line) as { request_id?: string });
      expect(logged.some((entry) => entry.request_id === response.body.error.requestId)).toBe(true);
    });
  });

  describe('error translation', () => {
    it('answers a database trigger violation (23514) with 422 and no database text', async () => {
      const workflow = await seedDraftWorkflow(db.platform, tenantA);
      const response = await request(app.getHttpServer())
        .get('/test/invalid-step-change')
        .query({ stepId: workflow.startStepId })
        .set(bearer(tokenA))
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
      expect(JSON.stringify(response.body)).not.toMatch(/steps|trigger|relation/i);
    });

    it('answers a malformed body with 400 and the failing fields, without echoing values', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: 'secret-value' })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.issues).toEqual([expect.objectContaining({ path: 'email' })]);
      expect(JSON.stringify(response.body)).not.toContain('secret-value');
    });
  });
});
