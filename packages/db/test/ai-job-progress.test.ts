import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claim {
  out_tenant_id: string;
  out_job_id: string;
  out_claim_token: string;
  out_attempt: number;
}

const CHANNEL = 'procesabpm_realtime';
const INPUT = { description: 'El asesor pide un anticipo y lo aprueba su jefe.' };
const INVALID_PARAMETER = '22023';

describe('AI requests: progress, cancel, history and their realtime signals (migration 20261029000200)', () => {
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
  const request = (tenant: SeededTenant, versionId: string = randomUUID()) =>
    withContext(db.runtime, tenant, async (client) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model)
           VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $4, 0, $5::jsonb, 48, 'deepseek-v4-pro') RETURNING id`,
          [tenant.tenantId, tenant.userId, randomUUID(), versionId, JSON.stringify(INPUT)],
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
  const setStage = (c: Claim, stage: string | null, round: number | null = null, problems: number | null = null, token = c.out_claim_token) =>
    worker<{ ok: boolean }>('SELECT set_ai_job_stage($1, $2, $3, $4::ai_job_stage, $5, $6) AS ok', [c.out_tenant_id, c.out_job_id, token, stage, round, problems]).then((r) => r[0]!.ok);
  const renew = (c: Claim) => worker<{ ok: boolean }>('SELECT renew_ai_job_lease($1, $2, $3) AS ok', [c.out_tenant_id, c.out_job_id, c.out_claim_token]).then((r) => r[0]!.ok);
  const finish = (c: Claim) => worker<{ ok: boolean }>(`SELECT finish_ai_job($1, $2, $3, '{"revision": 1}'::jsonb) AS ok`, [c.out_tenant_id, c.out_job_id, c.out_claim_token]).then((r) => r[0]!.ok);
  const fail = (c: Claim, code: string) => worker<{ ok: boolean }>('SELECT fail_ai_job($1, $2, $3, $4) AS ok', [c.out_tenant_id, c.out_job_id, c.out_claim_token, code]).then((r) => r[0]!.ok);
  const cancelAs = (context: { tenantId?: string; userId?: string }, jobId: string, pool: pg.Pool = db.runtime) =>
    withContext(pool, context, async (client) => (await client.query<{ ok: boolean }>('SELECT cancel_ai_job($1) AS ok', [jobId])).rows[0]!.ok);
  const row = async (id: string) => (await db.owner.query('SELECT * FROM ai_jobs WHERE id = $1', [id])).rows[0];

  /** Waits for the signals of the statements run by `work` (a marker sent after them arrives last). */
  const signalsOf = async (work: () => Promise<unknown>): Promise<Array<Record<string, unknown>>> => {
    await flush();
    received.length = 0;
    await work();
    await flush();
    return [...received];
  };
  const flush = async () => {
    const marker = randomUUID();
    await db.owner.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ v: 1, k: 'marker', m: marker })]);
    for (let waited = 0; !received.some((signal) => signal.m === marker) && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    const index = received.findIndex((signal) => signal.m === marker);
    if (index >= 0) received.splice(index, 1);
  };
  const aiSignals = (signals: Array<Record<string, unknown>>, jobId: string) => signals.filter((signal) => signal.k === 'ai_job' && signal.id === jobId);

  describe('progress', () => {
    it('a claim starts at READING; the worker moves it with its claim token, and a PENDING request has none', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      expect(await row(id)).toMatchObject({ stage: null, round: null, problems: null });
      const c = await claimOf(id);
      expect(await row(id)).toMatchObject({ status: 'RUNNING', stage: 'READING', round: null, problems: null });
      expect(await setStage(c, 'DESIGNING', 1)).toBe(true);
      expect(await setStage(c, 'REVIEWING', 1, 4)).toBe(true);
      expect(await row(id)).toMatchObject({ stage: 'REVIEWING', round: 1, problems: 4 });
      expect(await setStage(c, 'WRITING', 2)).toBe(true);
      expect(await setStage(c, 'DESIGNING', 2, null, randomUUID())).toBe(false);
      expect(await finish(c)).toBe(true);
      expect(await row(id)).toMatchObject({ status: 'SUCCEEDED', stage: 'WRITING', round: 2, input: INPUT });
      expect(await setStage(c, 'DESIGNING', 3)).toBe(false);
    });

    it('a second attempt starts again at READING', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const first = await claimOf(id);
      await setStage(first, 'REVIEWING', 2, 1);
      await db.owner.query(`UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
      const second = await claimOf(id);
      expect(second.out_attempt).toBe(2);
      expect(await row(id)).toMatchObject({ stage: 'READING', round: null, problems: null });
      expect(await setStage(first, 'DESIGNING', 3)).toBe(false);
      await fail(second, 'AI_DRAFT_INVALID');
    });

    it('refuses progress that does not make sense', async () => {
      const tenant = await enabledTenant();
      const c = await claimOf(await request(tenant));
      for (const [stage, round, problems] of [
        [null, null, null],
        ['READING', 1, null],
        ['DESIGNING', null, null],
        ['DESIGNING', 1, 2],
        ['REVIEWING', 1, null],
        ['REVIEWING', 0, 1],
        ['REVIEWING', 21, 1],
        ['REVIEWING', 1, -1],
        ['WRITING', 1, 1],
      ] as const) {
        expect(await sqlStateOf(() => setStage(c, stage, round, problems)), `${stage} ${round} ${problems}`).toBe(INVALID_PARAMETER);
      }
      await fail(c, 'AI_DRAFT_INVALID');
    });

    it('is the worker’s only: the API role cannot write progress, by function or by UPDATE', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const c = await claimOf(id);
      for (const pool of [db.runtime, db.platform]) {
        expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query(`SELECT set_ai_job_stage($1, $2, $3, 'DESIGNING', 1, NULL)`, [c.out_tenant_id, id, c.out_claim_token])))).toBe(SqlState.insufficientPrivilege);
      }
      expect(await sqlStateOf(() => withContext(db.runtime, tenant, (client) => client.query(`UPDATE ai_jobs SET stage = 'WRITING' WHERE id = $1`, [id])))).toBe(SqlState.insufficientPrivilege);
      await fail(c, 'AI_DRAFT_INVALID');
    });

    it('keeps the rules in the table too: no progress while PENDING, numbers only with a stage, none at insert', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      for (const sql of [
        `UPDATE ai_jobs SET stage = 'READING' WHERE id = $1`,
        `UPDATE ai_jobs SET status = 'RUNNING', attempts = 1, claim_token = gen_random_uuid(), lease_until = now(), round = 1 WHERE id = $1`,
        `UPDATE ai_jobs SET status = 'RUNNING', attempts = 1, claim_token = gen_random_uuid(), lease_until = now(), stage = 'DESIGNING' WHERE id = $1`,
      ]) {
        expect(await sqlStateOf(() => db.owner.query(sql, [id])), sql).toBe(SqlState.checkViolation);
      }
      expect(
        await sqlStateOf(() =>
          withContext(db.runtime, tenant, (client) =>
            client.query(
              `INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model, stage)
               VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $3, 0, $4::jsonb, 1, 'm', 'READING')`,
              [tenant.tenantId, tenant.userId, randomUUID(), JSON.stringify(INPUT)],
            ),
          ),
        ),
      ).toBe(SqlState.checkViolation);
    });
  });

  describe('cancel', () => {
    it('ends an open request CANCELLED for the member in context, keeps its description, and frees the draft', async () => {
      const tenant = await enabledTenant();
      const versionId = randomUUID();
      const id = await request(tenant, versionId);
      const colleague = await seedMember(db.platform, tenant);
      expect(await cancelAs({ tenantId: tenant.tenantId, userId: colleague }, id)).toBe(true);
      const cancelled = await row(id);
      expect(cancelled).toMatchObject({ status: 'FAILED', error_code: 'CANCELLED', cancelled_by_id: colleague, claim_token: null, lease_until: null, input: INPUT, result: null });
      expect(cancelled.completed_at).not.toBeNull();
      expect(await cancelAs(tenant, id)).toBe(false);
      await request(tenant, versionId);
    });

    it('makes the worker stop: renewal, progress and finish all answer false, and nothing is recorded as its result', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const c = await claimOf(id);
      await setStage(c, 'DESIGNING', 1);
      expect(await cancelAs(tenant, id)).toBe(true);
      expect(await renew(c)).toBe(false);
      expect(await setStage(c, 'REVIEWING', 1, 2)).toBe(false);
      expect(await finish(c)).toBe(false);
      expect(await fail(c, 'AI_PROVIDER_FAILED')).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'FAILED', error_code: 'CANCELLED', result: null, stage: 'DESIGNING', round: 1 });
      // The call in flight was paid: it still goes to the ledger.
      await withContext(db.worker, { tenantId: tenant.tenantId, userId: '' }, (client) =>
        client.query(
          `INSERT INTO ai_usage (tenant_id, job_id, user_id, task_kind, provider, model, job_attempt, round, prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, outcome)
           VALUES ($1, $2, $3, 'WORKFLOW_DRAFT', 'deepseek', 'deepseek-v4-pro', 1, 1, 10, 0, 10, 0, 100, 'OK')`,
          [tenant.tenantId, id, tenant.userId],
        ),
      );
      expect(await claimOfOrNothing(id)).toBeUndefined();
    });

    it('acts only inside the tenant in context: another tenant’s request is not found and stays as it was', async () => {
      const [a, b] = [await enabledTenant(), await enabledTenant()];
      const id = await request(a);
      expect(await cancelAs(b, id)).toBe(false);
      expect(await cancelAs({ tenantId: b.tenantId, userId: a.userId }, id).catch(() => 'refused')).toBe('refused');
      expect(await row(id)).toMatchObject({ status: 'PENDING', error_code: null, cancelled_by_id: null });
      expect(await cancelAs(a, id)).toBe(true);
    });

    it('needs the tenant and an active member in context', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      expect(await sqlStateOf(() => cancelAs({}, id))).toBe(SqlState.insufficientPrivilege);
      expect(await sqlStateOf(() => cancelAs({ tenantId: tenant.tenantId }, id))).toBe(SqlState.insufficientPrivilege);
      const leaving = await seedMember(db.platform, tenant);
      await db.owner.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [tenant.tenantId, leaving]);
      expect(await sqlStateOf(() => cancelAs({ tenantId: tenant.tenantId, userId: leaving }, id))).toBe(SqlState.insufficientPrivilege);
      expect(await row(id)).toMatchObject({ status: 'PENDING' });
    });

    it('CANCELLED is the cancel function’s alone, and always names who cancelled', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const c = await claimOf(id);
      expect(await sqlStateOf(() => fail(c, 'CANCELLED'))).toBe(INVALID_PARAMETER);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE ai_jobs SET status = 'FAILED', claim_token = NULL, lease_until = NULL, error_code = 'CANCELLED', completed_at = now() WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => db.owner.query(`UPDATE ai_jobs SET cancelled_by_id = requested_by_id WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
      await fail(c, 'AI_DRAFT_INVALID');
    });
  });

  describe('realtime signals', () => {
    it('signals a new request, every change of status or progress and a cancel, with ids only; a lease renewal is silent', async () => {
      const tenant = await enabledTenant();
      const versionId = randomUUID();
      let id = '';
      const created = await signalsOf(async () => {
        id = await request(tenant, versionId);
      });
      const expected = { v: 1, k: 'ai_job', t: tenant.tenantId, id, w: versionId };
      expect(aiSignals(created, id)).toEqual([expected]);
      let c: Claim | undefined;
      expect(aiSignals(await signalsOf(async () => (c = await claimOf(id))), id)).toEqual([expected]);
      expect(aiSignals(await signalsOf(() => setStage(c!, 'DESIGNING', 1)), id)).toEqual([expected]);
      expect(aiSignals(await signalsOf(() => setStage(c!, 'DESIGNING', 1)), id)).toEqual([]);
      expect(aiSignals(await signalsOf(() => renew(c!)), id)).toEqual([]);
      expect(aiSignals(await signalsOf(() => cancelAs(tenant, id)), id)).toEqual([expected]);
    });

    it('does not signal a change that rolled back', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const signals = await signalsOf(() =>
        withContext(db.runtime, tenant, async (client) => {
          await client.query('SELECT cancel_ai_job($1)', [id]);
          throw new Error('rolled back');
        }).catch(() => undefined),
      );
      expect(aiSignals(signals, id)).toEqual([]);
      expect(await row(id)).toMatchObject({ status: 'PENDING' });
    });
  });

  async function claimOfOrNothing(jobId: string): Promise<Claim | undefined> {
    const rows = await worker<Claim>(`SELECT * FROM claim_due_ai_jobs(10, interval '10 minutes')`);
    return rows.find((row) => row.out_job_id === jobId);
  }
});
