import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claim {
  out_tenant_id: string;
  out_job_id: string;
  out_claim_token: string;
  out_attempt: number;
}

type Kind = 'WORKFLOW_DRAFT' | 'WORKFLOW_DRAFT_REVISION';
const CHANNEL = 'procesabpm_realtime';
const INPUT = JSON.stringify({ description: 'agrega una revisión jurídica después de gerencia' });

describe('AI requests that revise the current draft (migrations 20261029000300 and 20261029000400)', () => {
  let db: TestDatabase;
  let listener: pg.Client;
  const received: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    db = connectTestDatabase();
    listener = new pg.Client({ connectionString: inject('ownerUrl') });
    await listener.connect();
    listener.on('notification', (message) => received.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
    await listener.query(`LISTEN ${CHANNEL}`);
  });
  afterAll(async () => {
    await listener.end();
    await db.close();
  });

  async function enabledTenant(): Promise<SeededTenant> {
    const tenant = await seedTenant(db.platform);
    await withContext(db.runtime, tenant, (c) => c.query('UPDATE tenants SET ai_assistant_enabled = true WHERE id = $1', [tenant.tenantId]));
    return tenant;
  }
  const request = (tenant: SeededTenant, kind: Kind = 'WORKFLOW_DRAFT_REVISION', versionId: string | null = randomUUID()) =>
    withContext(db.runtime, tenant, async (client) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model)
           VALUES ($1, $2::ai_task_kind, $3, $4, $5, $6, $7::jsonb, 48, 'deepseek-v4-pro') RETURNING id`,
          [tenant.tenantId, kind, tenant.userId, versionId === null ? null : randomUUID(), versionId, versionId === null ? null : 4, INPUT],
        )
      ).rows[0]!.id,
    );
  const worker = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => withoutContext(db.worker, async (client) => (await client.query<T>(sql, params)).rows);
  async function claimOf(jobId: string): Promise<Claim> {
    for (let round = 0; round < 20; round += 1) {
      const rows = await worker<Claim>(`SELECT * FROM claim_due_ai_jobs(10, interval '10 minutes')`);
      const mine = rows.find((row) => row.out_job_id === jobId);
      if (mine !== undefined) return mine;
      if (rows.length === 0) break;
    }
    throw new Error(`request ${jobId} was not claimed`);
  }
  const recordUsage = (tenant: SeededTenant, jobId: string, kind: Kind) =>
    withContext(db.worker, { tenantId: tenant.tenantId, userId: '' }, (c) =>
      c.query(
        `INSERT INTO ai_usage (tenant_id, job_id, user_id, task_kind, provider, model, job_attempt, round, prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, outcome)
         VALUES ($1, $2, $3, $4::ai_task_kind, 'openai-compatible', 'deepseek-v4-pro', 1, 1, 3500, 0, 9000, 6000, 60000, 'OK')`,
        [tenant.tenantId, jobId, tenant.userId, kind],
      ),
    );
  const row = async (id: string) => (await db.owner.query('SELECT * FROM ai_jobs WHERE id = $1', [id])).rows[0];
  const flush = async () => {
    const marker = randomUUID();
    await db.owner.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ v: 1, k: 'marker', m: marker })]);
    for (let waited = 0; !received.some((signal) => signal.m === marker) && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  };

  it('is asked like a new draft: fresh, PENDING, by the member in context, and only with its draft and revision', async () => {
    const tenant = await enabledTenant();
    const id = await request(tenant);
    expect(await row(id)).toMatchObject({ kind: 'WORKFLOW_DRAFT_REVISION', status: 'PENDING', expected_revision: 4, input: JSON.parse(INPUT) });
    expect(await sqlStateOf(() => request(tenant, 'WORKFLOW_DRAFT_REVISION', null))).toBe(SqlState.checkViolation);
    const off = await seedTenant(db.platform);
    expect(await sqlStateOf(() => request(off))).toBe(SqlState.insufficientPrivilege);
  });

  it('shares the one-in-flight rule of the draft with new drafts', async () => {
    const tenant = await enabledTenant();
    const versionId = randomUUID();
    await request(tenant, 'WORKFLOW_DRAFT', versionId);
    expect(await sqlStateOf(() => request(tenant, 'WORKFLOW_DRAFT_REVISION', versionId))).toBe(SqlState.uniqueViolation);
  });

  it('goes through the worker protocol, signals its changes with ids only, and keeps the message', async () => {
    const tenant = await enabledTenant();
    const versionId = randomUUID();
    await flush();
    received.length = 0;
    const id = await request(tenant, 'WORKFLOW_DRAFT_REVISION', versionId);
    const claim = await claimOf(id);
    expect((await worker<{ ok: boolean }>(`SELECT set_ai_job_stage($1, $2, $3, 'DESIGNING', 1, NULL) AS ok`, [claim.out_tenant_id, id, claim.out_claim_token]))[0]!.ok).toBe(true);
    expect((await worker<{ ok: boolean }>(`SELECT finish_ai_job($1, $2, $3, '{"revision": 5}'::jsonb) AS ok`, [claim.out_tenant_id, id, claim.out_claim_token]))[0]!.ok).toBe(true);
    await flush();
    expect(await row(id)).toMatchObject({ status: 'SUCCEEDED', input: JSON.parse(INPUT) });
    const signals = received.filter((signal) => signal.k === 'ai_job' && signal.id === id);
    expect(signals.length).toBeGreaterThanOrEqual(3);
    for (const signal of signals) expect(signal).toEqual({ v: 1, k: 'ai_job', t: tenant.tenantId, id, w: versionId });
  });

  it('records its calls in the ledger under its own kind only', async () => {
    const tenant = await enabledTenant();
    const id = await request(tenant);
    await claimOf(id);
    await recordUsage(tenant, id, 'WORKFLOW_DRAFT_REVISION');
    expect(await sqlStateOf(() => recordUsage(tenant, id, 'WORKFLOW_DRAFT'))).toBe(SqlState.checkViolation);
  });

  it('can be cancelled, and another tenant neither sees nor cancels it', async () => {
    const [a, b] = [await enabledTenant(), await enabledTenant()];
    const id = await request(a);
    expect(await withContext(db.runtime, b, async (c) => (await c.query('SELECT id FROM ai_jobs WHERE id = $1', [id])).rowCount)).toBe(0);
    expect(await withContext(db.runtime, b, async (c) => (await c.query<{ ok: boolean }>('SELECT cancel_ai_job($1) AS ok', [id])).rows[0]!.ok)).toBe(false);
    expect(await withContext(db.runtime, a, async (c) => (await c.query<{ ok: boolean }>('SELECT cancel_ai_job($1) AS ok', [id])).rows[0]!.ok)).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'FAILED', error_code: 'CANCELLED', cancelled_by_id: a.userId });
  });

  it('goes with retention 90 days after it ended, like any request', async () => {
    const tenant = await enabledTenant();
    const [old, recent] = [await request(tenant), await request(tenant)];
    const client = await db.owner.connect();
    try {
      await client.query('BEGIN');
      const end = (id: string, days: number) => client.query(`UPDATE ai_jobs SET status = 'FAILED', error_code = 'AI_DRAFT_INVALID', completed_at = now() - make_interval(days => $2::int) WHERE id = $1`, [id, days]);
      await end(old, 91);
      await end(recent, 89);
      await client.query('SET LOCAL ROLE app_worker');
      await client.query('SELECT retention_purge_ai_jobs(10000)');
      await client.query('RESET ROLE');
      expect((await client.query<{ id: string }>('SELECT id FROM ai_jobs WHERE id = ANY($1::uuid[])', [[old, recent]])).rows.map((r) => r.id)).toEqual([recent]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
