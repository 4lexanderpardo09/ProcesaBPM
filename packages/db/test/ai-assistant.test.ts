import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withContext, withoutContext, type TestDatabase } from './support/database.js';
import { seedMember, seedTenant, type SeededTenant } from './support/fixtures.js';

interface Claim {
  out_tenant_id: string;
  out_job_id: string;
  out_claim_token: string;
  out_attempt: number;
}

const INPUT = JSON.stringify({ description: 'El asesor pide un anticipo y lo aprueba su jefe.' });

describe('AI assistant: requests and the token ledger', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = connectTestDatabase();
  });
  afterAll(() => db.close());

  async function enabledTenant(): Promise<SeededTenant> {
    const tenant = await seedTenant(db.platform);
    await withContext(db.runtime, tenant, (c) => c.query('UPDATE tenants SET ai_assistant_enabled = true WHERE id = $1', [tenant.tenantId]));
    return tenant;
  }
  const request = (tenant: SeededTenant, userId = tenant.userId, columns = '', values = '', versionId: string = randomUUID()) =>
    withContext(db.runtime, { tenantId: tenant.tenantId, userId }, async (client) =>
      (
        await client.query<{ id: string }>(
          `INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model${columns})
           VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $4, 0, $5::jsonb, 48, 'deepseek-v4-pro'${values}) RETURNING id`,
          [tenant.tenantId, userId, randomUUID(), versionId, INPUT],
        )
      ).rows[0]!.id,
    );
  const worker = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => withoutContext(db.worker, async (client) => (await client.query<T>(sql, params)).rows);
  const claim = (lease = '10 minutes') => worker<Claim>('SELECT * FROM claim_due_ai_jobs(10, $1::interval)', [lease]);
  async function claimOf(jobId: string): Promise<Claim | undefined> {
    for (let round = 0; round < 20; round += 1) {
      const rows = await claim();
      const mine = rows.find((row) => row.out_job_id === jobId);
      if (mine !== undefined || rows.length === 0) return mine;
    }
    return undefined;
  }
  const renew = (c: Claim) => worker<{ ok: boolean }>('SELECT renew_ai_job_lease($1, $2, $3) AS ok', [c.out_tenant_id, c.out_job_id, c.out_claim_token]).then((r) => r[0]!.ok);
  const finish = (c: Claim, result: object = { revision: 3 }) => worker<{ ok: boolean }>('SELECT finish_ai_job($1, $2, $3, $4::jsonb) AS ok', [c.out_tenant_id, c.out_job_id, c.out_claim_token, JSON.stringify(result)]).then((r) => r[0]!.ok);
  const fail = (c: Claim, code = 'AI_DRAFT_INVALID') => worker<{ ok: boolean }>('SELECT fail_ai_job($1, $2, $3, $4) AS ok', [c.out_tenant_id, c.out_job_id, c.out_claim_token, code]).then((r) => r[0]!.ok);
  const row = async (tenant: SeededTenant, id: string) => (await db.owner.query('SELECT * FROM ai_jobs WHERE tenant_id = $1 AND id = $2', [tenant.tenantId, id])).rows[0];
  const expireLease = (id: string) => db.owner.query(`UPDATE ai_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [id]);
  const recordUsage = (tenant: SeededTenant, jobId: string, userId = tenant.userId, client: pg.Pool = db.worker) =>
    withContext(client, { tenantId: tenant.tenantId, userId: '' }, (c) =>
      c.query(
        `INSERT INTO ai_usage (tenant_id, job_id, user_id, task_kind, provider, model, job_attempt, round, prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, duration_ms, outcome)
         VALUES ($1, $2, $3, 'WORKFLOW_DRAFT', 'openai-compatible', 'deepseek-v4-pro', 1, 1, 3500, 0, 9000, 6000, 60000, 'OK') RETURNING id, created_at`,
        [tenant.tenantId, jobId, userId],
      ),
    );

  describe('the setting', () => {
    it('is off by default and the API role can turn it on for its own tenant only', async () => {
      const [a, b] = [await seedTenant(db.platform), await seedTenant(db.platform)];
      expect((await db.owner.query('SELECT ai_assistant_enabled FROM tenants WHERE id = $1', [a.tenantId])).rows[0].ai_assistant_enabled).toBe(false);
      await withContext(db.runtime, a, (c) => c.query('UPDATE tenants SET ai_assistant_enabled = true WHERE id = $1', [b.tenantId]));
      expect((await db.owner.query('SELECT ai_assistant_enabled FROM tenants WHERE id = $1', [b.tenantId])).rows[0].ai_assistant_enabled).toBe(false);
    });
  });

  describe('requests (what the API may insert)', () => {
    it('lets an active member of a tenant with the assistant on ask for a fresh PENDING request, dated by the database', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant, tenant.userId, ', created_at', `, now() - interval '3 days'`);
      const created = await row(tenant, id);
      expect(created).toMatchObject({ status: 'PENDING', attempts: 0, claim_token: null, requested_by_id: tenant.userId, input: JSON.parse(INPUT), result: null });
      expect(Math.abs(created.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it('refuses a request when the organization did not turn the assistant on, or is suspended', async () => {
      const off = await seedTenant(db.platform);
      expect(await sqlStateOf(() => request(off))).toBe(SqlState.insufficientPrivilege);
      const suspended = await enabledTenant();
      await db.owner.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [suspended.tenantId]);
      expect(await sqlStateOf(() => request(suspended))).toBe(SqlState.insufficientPrivilege);
    });

    it('refuses a request that is not fresh, has no input, misses its draft, or is made for someone else', async () => {
      const tenant = await enabledTenant();
      for (const [columns, values] of [
        [', status', `, 'RUNNING'`],
        [', attempts', ', 1'],
        [', result', `, '{}'::jsonb`],
        [', error_code', `, 'BOOM'`],
        [', completed_at', ', now()'],
      ]) {
        expect(await sqlStateOf(() => request(tenant, tenant.userId, columns, values)), columns).toBe(SqlState.checkViolation);
      }
      expect(
        await sqlStateOf(() =>
          withContext(db.runtime, tenant, (c) =>
            c.query(`INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, input_chars, model, input) VALUES ($1, 'WORKFLOW_DRAFT', $2, 1, 'm', $3::jsonb)`, [tenant.tenantId, tenant.userId, INPUT]),
          ),
        ),
      ).toBe(SqlState.checkViolation);
      const other = await seedMember(db.platform, tenant);
      expect(await sqlStateOf(() => withContext(db.runtime, tenant, (c) => c.query(`INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model) VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $3, 0, $4::jsonb, 1, 'm')`, [tenant.tenantId, other, randomUUID(), INPUT])))).toBe(
        SqlState.insufficientPrivilege,
      );
    });

    it('allows one request in flight per draft', async () => {
      const tenant = await enabledTenant();
      const versionId = randomUUID();
      await request(tenant, tenant.userId, '', '', versionId);
      expect(await sqlStateOf(() => request(tenant, tenant.userId, '', '', versionId))).toBe(SqlState.uniqueViolation);
      await request(tenant);
    });

    it('never lets the API change or delete a request', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      for (const sql of [`UPDATE ai_jobs SET status = 'SUCCEEDED' WHERE id = $1`, `UPDATE ai_jobs SET input = NULL WHERE id = $1`, 'DELETE FROM ai_jobs WHERE id = $1']) {
        expect(await sqlStateOf(() => withContext(db.runtime, tenant, (c) => c.query(sql, [id]))), sql).toBe(SqlState.insufficientPrivilege);
      }
    });

    it('keeps tenants apart: another tenant neither sees nor writes the requests or the ledger', async () => {
      const [a, b] = [await enabledTenant(), await enabledTenant()];
      const id = await request(a);
      const c = (await claimOf(id))!;
      await recordUsage(a, id);
      const seenByB = await withContext(db.runtime, b, async (client) => ({
        jobs: (await client.query('SELECT id FROM ai_jobs WHERE id = $1', [id])).rows,
        usage: (await client.query('SELECT id FROM ai_usage WHERE job_id = $1', [id])).rows,
      }));
      expect(seenByB).toEqual({ jobs: [], usage: [] });
      expect(await sqlStateOf(() => withContext(db.runtime, { tenantId: b.tenantId, userId: a.userId }, (client) => client.query(`INSERT INTO ai_jobs (tenant_id, kind, requested_by_id, workflow_id, version_id, expected_revision, input, input_chars, model) VALUES ($1, 'WORKFLOW_DRAFT', $2, $3, $3, 0, $4::jsonb, 1, 'm')`, [a.tenantId, a.userId, randomUUID(), INPUT])))).toBe(
        SqlState.insufficientPrivilege,
      );
      expect(await sqlStateOf(() => recordUsage(b, id, a.userId))).toBe(SqlState.checkViolation);
      expect(await finish(c)).toBe(true);
    });
  });

  describe('the worker protocol', () => {
    it('claims a request, renews it, and finishes it: SUCCEEDED with its result and without the description', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const c = (await claimOf(id))!;
      expect(c).toMatchObject({ out_tenant_id: tenant.tenantId, out_attempt: 1 });
      expect(await row(tenant, id)).toMatchObject({ status: 'RUNNING', attempts: 1 });
      expect(await renew(c)).toBe(true);
      expect(await finish(c, { revision: 4, rounds: 2 })).toBe(true);
      expect(await row(tenant, id)).toMatchObject({ status: 'SUCCEEDED', input: null, claim_token: null, result: { revision: 4, rounds: 2 } });
      expect(await finish(c)).toBe(false);
      expect(await renew(c)).toBe(false);
    });

    it('fails a request for good with a code, dropping the description', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const c = (await claimOf(id))!;
      expect(await fail(c)).toBe(true);
      expect(await row(tenant, id)).toMatchObject({ status: 'FAILED', error_code: 'AI_DRAFT_INVALID', input: null, result: null });
      expect(await claimOf(id)).toBeUndefined();
    });

    it('retries a request whose worker died once, then ends it LEASE_EXPIRED; a stale token cannot act', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      const first = (await claimOf(id))!;
      await expireLease(id);
      const second = (await claimOf(id))!;
      expect(second.out_attempt).toBe(2);
      expect(await finish(first)).toBe(false);
      await expireLease(id);
      expect(await claimOf(id)).toBeUndefined();
      expect(await row(tenant, id)).toMatchObject({ status: 'FAILED', error_code: 'LEASE_EXPIRED', input: null });
    });

    it('is the worker’s only: neither the API role nor the platform role runs it', async () => {
      for (const pool of [db.runtime, db.platform]) {
        expect(await sqlStateOf(() => withoutContext(pool, (c) => c.query('SELECT * FROM claim_due_ai_jobs(1)')))).toBe(SqlState.insufficientPrivilege);
      }
    });
  });

  describe('the ledger', () => {
    it('records the calls of a running request, dated by the database, and never changes them', async () => {
      const tenant = await enabledTenant();
      const id = await request(tenant);
      expect(await sqlStateOf(() => recordUsage(tenant, id))).toBe(SqlState.checkViolation);
      const c = (await claimOf(id))!;
      const usage = (await recordUsage(tenant, id)).rows[0];
      expect(Math.abs(usage.created_at.getTime() - Date.now())).toBeLessThan(60_000);
      const other = await seedMember(db.platform, tenant);
      expect(await sqlStateOf(() => recordUsage(tenant, id, other))).toBe(SqlState.checkViolation);
      for (const sql of ['UPDATE ai_usage SET prompt_tokens = 0 WHERE id = $1', 'DELETE FROM ai_usage WHERE id = $1']) {
        expect(await sqlStateOf(() => withContext(db.worker, { tenantId: tenant.tenantId, userId: '' }, (client) => client.query(sql, [usage.id]))), sql).toBe(SqlState.insufficientPrivilege);
      }
      expect(await finish(c)).toBe(true);
      expect(await sqlStateOf(() => recordUsage(tenant, id))).toBe(SqlState.checkViolation);
    });
  });
});
