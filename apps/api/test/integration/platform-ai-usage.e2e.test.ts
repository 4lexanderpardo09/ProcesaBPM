import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

/** A past month no other test writes to, so the figures are exact. */
const PERIOD = '?from=2025-03-01&to=2025-03-31';
const SECRET_DESCRIPTION = 'Descripción secreta del flujo de anticipos';
const SECRET_RESULT = 'resumen-secreto';

interface Call {
  readonly prompt: number;
  readonly cached?: number;
  readonly completion: number;
  readonly reasoning?: number;
}

describe('platform console: AI usage per organization', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let token: string;
  const http = () => request(app.getHttpServer());
  const report = (query = PERIOD) => http().get(`/platform/ai-usage${query}`).set(bearer(token));

  /**
   * Requests and calls dated in the past: `created_at` is set by the database and the worker protocol only moves a
   * request forward, so the rows are written by the owner with triggers off.
   */
  async function seedJob(tenant: SeededTenant, status: 'PENDING' | 'SUCCEEDED' | 'FAILED', createdAt: string, calls: readonly Call[] = []): Promise<void> {
    const client = await db.owner.connect();
    try {
      await client.query('SET session_replication_role = replica');
      const open = status === 'PENDING';
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ai_jobs (tenant_id, kind, status, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model, attempts, error_code, result, created_at, completed_at)
         VALUES ($1, 'WORKFLOW_DRAFT', $2::ai_job_status, $3, $4, $5, 0, $6::jsonb, 42, 'deepseek-v4-pro', 1, $7, $8::jsonb, $9, $10) RETURNING id`,
        [
          tenant.tenantId,
          status,
          tenant.userId,
          randomUUID(),
          randomUUID(),
          open ? JSON.stringify({ description: SECRET_DESCRIPTION }) : null,
          status === 'FAILED' ? 'AI_DRAFT_INVALID' : null,
          status === 'SUCCEEDED' ? JSON.stringify({ summary: SECRET_RESULT }) : null,
          createdAt,
          open ? null : createdAt,
        ],
      );
      for (const [index, call] of calls.entries()) {
        await client.query(
          `INSERT INTO ai_usage (tenant_id, job_id, user_id, task_kind, provider, model, job_attempt, round, prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, outcome, created_at)
           VALUES ($1, $2, $3, 'WORKFLOW_DRAFT', 'deepseek', 'deepseek-v4-pro', 1, $4, $5, $6, $7, $8, 1000, 'OK', $9)`,
          [tenant.tenantId, rows[0]!.id, tenant.userId, index + 1, call.prompt, call.cached ?? 0, call.completion, call.reasoning ?? 0, createdAt],
        );
      }
    } finally {
      await client.query('RESET session_replication_role');
      client.release();
    }
  }
  const enable = (tenant: SeededTenant) => db.owner.query('UPDATE tenants SET ai_assistant_enabled = true WHERE id = $1', [tenant.tenantId]);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    token = await signInPlatform(app, db, await seedPlatformAdmin(db));
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('adds up each organization and the platform for the period, the most tokens first, without descriptions or results', async () => {
    const [busy, light, idle, never] = [await seedTenant(db.platform), await seedTenant(db.platform), await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([enable(busy), enable(idle)]);
    await seedJob(busy, 'SUCCEEDED', '2025-03-01T00:00:00Z', [
      { prompt: 3000, cached: 1000, completion: 9000, reasoning: 6000 },
      { prompt: 4000, completion: 1000 },
    ]);
    await seedJob(busy, 'FAILED', '2025-03-31T23:59:59Z', [{ prompt: 2000, completion: 0 }]);
    await seedJob(busy, 'PENDING', '2025-03-15T10:00:00Z');
    // The day before and the day after the period do not count.
    await seedJob(busy, 'SUCCEEDED', '2025-02-28T23:59:59Z', [{ prompt: 99_999, completion: 99_999 }]);
    await seedJob(busy, 'SUCCEEDED', '2025-04-01T00:00:00Z', [{ prompt: 99_999, completion: 99_999 }]);
    // Turned off since, but it spent in the period.
    await seedJob(light, 'SUCCEEDED', '2025-03-10T12:00:00Z', [{ prompt: 500, completion: 700, reasoning: 100 }]);

    const { body } = await report().expect(200);

    expect(body.from).toBe('2025-03-01');
    expect(body.to).toBe('2025-03-31');
    const ours = body.tenants.filter((row: { tenantId: string }) => [busy, light, idle, never].some((tenant) => tenant.tenantId === row.tenantId));
    expect(ours.map((row: { tenantId: string }) => row.tenantId)).toEqual([busy.tenantId, light.tenantId, idle.tenantId]);
    expect(ours[0]).toEqual({
      tenantId: busy.tenantId,
      slug: expect.any(String),
      name: expect.any(String),
      status: 'ACTIVE',
      assistantEnabled: true,
      jobs: { total: 3, succeeded: 1, failed: 1 },
      calls: 3,
      promptTokens: 9000,
      cachedPromptTokens: 1000,
      completionTokens: 10_000,
      reasoningTokens: 6000,
      totalTokens: 19_000,
    });
    expect(ours[1]).toMatchObject({ assistantEnabled: false, jobs: { total: 1, succeeded: 1, failed: 0 }, calls: 1, totalTokens: 1200, reasoningTokens: 100 });
    expect(ours[2]).toMatchObject({ assistantEnabled: true, jobs: { total: 0, succeeded: 0, failed: 0 }, calls: 0, totalTokens: 0 });
    expect(body.totals).toEqual({
      jobs: { total: 4, succeeded: 2, failed: 1 },
      calls: 4,
      promptTokens: 9500,
      cachedPromptTokens: 1000,
      completionTokens: 10_700,
      reasoningTokens: 6100,
      totalTokens: 20_200,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(SECRET_DESCRIPTION);
    expect(raw).not.toContain(SECRET_RESULT);
  });

  it('covers the current UTC month by default', async () => {
    const { body } = await report('').expect(200);
    const now = new Date();
    expect(body.from).toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10));
    expect(body.to).toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
  });

  it('refuses half a period, an end before the start, more than 400 days and unknown filters', async () => {
    await report('?from=2025-03-01').expect(400);
    await report('?from=2025-03-02&to=2025-03-01').expect(400);
    await report('?from=2024-01-01&to=2025-03-01').expect(400);
    await report(`?tenantId=${randomUUID()}`).expect(400);
  });

  it('is for platform administrators only', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await http().get('/platform/ai-usage').set(bearer(accessToken)).expect(403);
    await http().get('/platform/ai-usage').expect(401);
  });
});
