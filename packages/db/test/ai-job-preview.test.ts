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

describe('AI requests: the diagram so far while the model writes it (migration 20261030000100)', () => {
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

  const PREVIEW = { steps: [{ ref: 'inicio', type: 'START', name: 'Solicitud' }, { ref: 'jefe', type: 'APPROVAL', name: 'Aprobación del jefe' }], transitions: [{ from: 'inicio', to: 'jefe', label: 'Enviar' }] };
  const setPreview = (c: Claim, round: number | null, preview: unknown = PREVIEW, token = c.out_claim_token) =>
    worker<{ ok: boolean }>('SELECT set_ai_job_preview($1, $2, $3, $4, $5::jsonb) AS ok', [c.out_tenant_id, c.out_job_id, token, round, preview === null ? null : JSON.stringify(preview)]).then((r) => r[0]!.ok);
  /** A request claimed and DESIGNING its first round. */
  async function designing(tenant?: SeededTenant) {
    const owner = tenant ?? (await enabledTenant());
    const id = await request(owner);
    const c = await claimOf(id);
    expect(await setStage(c, 'DESIGNING', 1)).toBe(true);
    return { tenant: owner, id, c };
  }

  it('the worker writes what the model has so far in the round being designed, and every new preview is signalled by ids only', async () => {
    const { tenant, id, c } = await designing();
    const signals = await signalsOf(async () => {
      expect(await setPreview(c, 1)).toBe(true);
      expect(await setPreview(c, 1, { ...PREVIEW, steps: PREVIEW.steps.slice(0, 1) })).toBe(true);
    });
    expect(aiSignals(signals, id)).toEqual([
      { v: 1, k: 'ai_job', t: tenant.tenantId, id, w: expect.any(String) },
      { v: 1, k: 'ai_job', t: tenant.tenantId, id, w: expect.any(String) },
    ]);
    expect(JSON.stringify(signals)).not.toContain('Aprobación');
    expect((await row(id)).preview).toEqual({ ...PREVIEW, steps: PREVIEW.steps.slice(0, 1) });
    await fail(c, 'AI_DRAFT_INVALID');
  });

  it('a late write is ignored: another round, another stage, another attempt or an ended request answer false', async () => {
    const { id, c } = await designing();
    expect(await setPreview(c, 2)).toBe(false);
    expect(await setPreview(c, 1, PREVIEW, randomUUID())).toBe(false);
    await setStage(c, 'REVIEWING', 1, 2);
    expect(await setPreview(c, 1)).toBe(false);
    await finish(c);
    expect(await setPreview(c, 1)).toBe(false);
    expect((await row(id)).preview).toBeNull();
  });

  it('lives only while its round runs: a new stage or round, a new attempt and the end of the request clear it', async () => {
    const { id, c } = await designing();
    await setPreview(c, 1);
    await setStage(c, 'REVIEWING', 1, 1);
    expect((await row(id)).preview).toBeNull();
    await setStage(c, 'DESIGNING', 2);
    await setPreview(c, 2);
    await renew(c);
    expect((await row(id)).preview).toEqual(PREVIEW);
    await db.owner.query(`UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
    const second = await claimOf(id);
    expect((await row(id)).preview).toBeNull();
    await setStage(second, 'DESIGNING', 1);
    await setPreview(second, 1);
    await fail(second, 'AI_DRAFT_INVALID');
    expect((await row(id)).preview).toBeNull();

    const cancelled = await designing();
    await setPreview(cancelled.c, 1);
    expect(await cancelAs(cancelled.tenant, cancelled.id)).toBe(true);
    expect((await row(cancelled.id)).preview).toBeNull();
  });

  it('refuses a preview that is not one: no round, no object, no lists, or too big', async () => {
    const { c } = await designing();
    for (const [round, preview] of [
      [null, PREVIEW],
      [0, PREVIEW],
      [21, PREVIEW],
      [1, null],
      [1, []],
      [1, { steps: [] }],
      [1, { steps: {}, transitions: [] }],
      [1, { steps: [{ name: 'x'.repeat(70_000) }], transitions: [] }],
    ] as const) {
      expect(await sqlStateOf(() => setPreview(c, round, preview)), JSON.stringify(preview).slice(0, 60)).toBe(INVALID_PARAMETER);
    }
    await fail(c, 'AI_DRAFT_INVALID');
  });

  it('is the worker’s only, and never part of a new request', async () => {
    const { tenant, id, c } = await designing();
    for (const pool of [db.runtime, db.platform]) {
      expect(await sqlStateOf(() => withoutContext(pool, (client) => client.query('SELECT set_ai_job_preview($1, $2, $3, 1, $4::jsonb)', [c.out_tenant_id, id, c.out_claim_token, JSON.stringify(PREVIEW)])))).toBe(
        SqlState.insufficientPrivilege,
      );
    }
    expect(await sqlStateOf(() => withContext(db.runtime, tenant, (client) => client.query('UPDATE ai_jobs SET preview = $2::jsonb WHERE id = $1', [id, JSON.stringify(PREVIEW)])))).toBe(SqlState.insufficientPrivilege);
    expect(
      await sqlStateOf(() =>
        withContext(db.runtime, tenant, (client) =>
          client.query(
            `INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model, preview)
             VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $3, 0, $4::jsonb, 1, 'm', $5::jsonb)`,
            [tenant.tenantId, tenant.userId, randomUUID(), JSON.stringify(INPUT), JSON.stringify(PREVIEW)],
          ),
        ),
      ),
    ).toBe(SqlState.checkViolation);
    // The table keeps the rules too, should anything write it directly.
    expect(await sqlStateOf(() => db.owner.query(`UPDATE ai_jobs SET preview = '[]'::jsonb WHERE id = $1`, [id]))).toBe(SqlState.checkViolation);
    await fail(c, 'AI_DRAFT_INVALID');
  });

  it('is read only inside its organization', async () => {
    const { id, c } = await designing();
    await setPreview(c, 1);
    const other = await enabledTenant();
    expect(await withContext(db.runtime, other, async (client) => (await client.query('SELECT preview FROM ai_jobs WHERE id = $1', [id])).rows)).toEqual([]);
    await fail(c, 'AI_DRAFT_INVALID');
  });
});
