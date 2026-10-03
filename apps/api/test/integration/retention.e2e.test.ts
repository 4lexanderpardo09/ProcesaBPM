import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { RetentionJob } from '../../src/modules/retention/application/retention.job.js';
import { RETENTION_STEPS } from '../../src/modules/retention/domain/retention-step.js';
import { WorkerModule } from '../../src/worker.module.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ LOG_LEVEL: 'info' });

/**
 * The job is cross-tenant by design: a run deletes every row of the shared test database that is past its window, not only
 * the ones this file creates. Other suites do not create rows that old, and this file only removes its own run rows.
 */

/** Text that only exists inside the rows: the log must never carry it. */
const SECRET_MARKER = `retention-secret-${randomUUID()}`;

describe('retention job (worker, real database)', () => {
  let db: TestDatabase;
  let moduleRef: TestingModule;
  let job: RetentionJob;
  const lines: string[] = [];

  beforeAll(async () => {
    db = connectTestDatabase();
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue((line: string) => lines.push(line))
      .compile();
    await moduleRef.init();
    job = moduleRef.get(RetentionJob);
  });
  afterAll(async () => {
    await moduleRef.close();
    await db.close();
  });
  /** Runs this file started: removed after each test (one run per 20 hours), and nothing else of the trail is touched. */
  const ownRuns: string[] = [];
  const runOnce = async (signal?: AbortSignal) => {
    const summary = await job.runOnce(signal);
    if (summary) ownRuns.push(summary.runId);
    return summary;
  };
  beforeEach(() => {
    lines.length = 0;
  });
  afterEach(async () => {
    await db.owner.query(`DELETE FROM platform_audit_logs WHERE id = ANY($1::uuid[]) OR (action = 'retention.run_finished' AND data ->> 'runId' = ANY($2::text[]))`, [ownRuns, ownRuns]);
    ownRuns.length = 0;
  });

  const ids = (sql: string, params: unknown[] = []) => db.owner.query<{ id: string }>(sql, params).then((result) => result.rows.map((row) => row.id));
  const remaining = async (table: string, candidates: string[]) => (await ids(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [candidates])).sort();
  const one = async (sql: string, params: unknown[]) => (await ids(sql, params))[0]!;

  /** Rows of one tenant on both sides of every window it has. */
  async function seedAges(tenant: SeededTenant) {
    const audit = (age: string) =>
      one(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, after, created_at) VALUES ($1, $2, 'role.updated', 'Role', $3, now() - $4::interval) RETURNING id`, [
        tenant.tenantId,
        tenant.userId,
        JSON.stringify({ note: SECRET_MARKER }),
        age,
      ]);
    const notification = (age: string) =>
      one(`INSERT INTO notifications (tenant_id, user_id, type, title, body, created_at) VALUES ($1, $2, 'SYSTEM', $3, 'b', now() - $4::interval) RETURNING id`, [
        tenant.tenantId,
        tenant.userId,
        SECRET_MARKER,
        age,
      ]);
    const outbox = (age: string) =>
      one(`INSERT INTO outbox_events (tenant_id, type, payload, status, processed_at) VALUES ($1, 'ticket.created', $2, 'DONE', now() - $3::interval) RETURNING id`, [
        tenant.tenantId,
        JSON.stringify({ note: SECRET_MARKER }),
        age,
      ]);
    const session = (age: string) =>
      one(`INSERT INTO refresh_sessions (user_id, active_tenant_id, token_hash, expires_at) VALUES ($1, $2, $3, now() - $4::interval) RETURNING id`, [
        tenant.userId,
        tenant.tenantId,
        createHash('sha256').update(randomUUID()).digest('hex'),
        age,
      ]);
    const token = (age: string) =>
      one(`INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES ($1, 'PASSWORD_RESET', $2, now() - $3::interval) RETURNING id`, [
        tenant.userId,
        createHash('sha256').update(randomUUID()).digest('hex'),
        age,
      ]);
    return {
      old: {
        audit_logs: await audit('2 years 1 day'),
        notifications: await notification('366 days'),
        outbox_events: await outbox('8 days'),
        refresh_sessions: await session('31 days'),
        user_tokens: await token('31 days'),
      },
      young: {
        audit_logs: await audit('729 days'),
        notifications: await notification('364 days'),
        outbox_events: await outbox('6 days'),
        refresh_sessions: await session('29 days'),
        user_tokens: await token('29 days'),
      },
    };
  }

  it('deletes what is past each window for every tenant, keeps the rest, and records the run in the platform trail', async () => {
    const [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    const [rowsA, rowsB] = [await seedAges(tenantA), await seedAges(tenantB)];
    // The trail dates new rows itself (trigger): backdate them as the owner.
    const platformAuditAged = async (age: string) => {
      const id = await one(`INSERT INTO platform_audit_logs (actor_user_id, action) VALUES ($1, 'tenant.suspended') RETURNING id`, [tenantA.userId]);
      await db.owner.query(`UPDATE platform_audit_logs SET created_at = now() - $2::interval WHERE id = $1`, [id, age]);
      return id;
    };
    const platformAudit = { old: await platformAuditAged('5 years 1 day'), young: await platformAuditAged('4 years') };

    const summary = await runOnce();

    expect(summary).toMatchObject({ failed: [] });
    for (const table of Object.keys(rowsA.old) as Array<keyof typeof rowsA.old>) {
      const old = [rowsA.old[table], rowsB.old[table]];
      const young = [rowsA.young[table], rowsB.young[table]];
      expect(await remaining(table, [...old, ...young]), table).toEqual(young.sort());
      expect(summary!.deleted[table], table).toBeGreaterThanOrEqual(2);
    }
    expect(await remaining('platform_audit_logs', [platformAudit.old, platformAudit.young])).toEqual([platformAudit.young]);

    const runs = await db.owner.query<{ action: string; actor_user_id: string | null; data: Record<string, unknown> }>(
      `SELECT action, actor_user_id, data FROM platform_audit_logs
       WHERE id = $1 OR (action = 'retention.run_finished' AND data ->> 'runId' = $1::text) ORDER BY created_at, action DESC`,
      [summary!.runId],
    );
    expect(runs.rows.map((row) => [row.action, row.actor_user_id])).toEqual([
      ['retention.run_started', null],
      ['retention.run_finished', null],
    ]);
    expect(runs.rows[1]!.data).toEqual({ runId: summary!.runId, deleted: summary!.deleted, failed: [], durationMs: summary!.durationMs, interrupted: false });
    expect(Object.keys(summary!.deleted).sort()).toEqual([...RETENTION_STEPS].sort());
  });

  it('logs counts per step and never the content of a row', async () => {
    const tenant = await seedTenant(db.platform);
    await seedAges(tenant);
    await runOnce();
    const events = lines.map((line) => JSON.parse(line) as { event?: string; step?: string; rows?: number });
    expect(events.filter((entry) => entry.event === 'retention.step_done').map((entry) => entry.step)).toEqual([...RETENTION_STEPS]);
    expect(events.find((entry) => entry.event === 'retention.step_done' && entry.step === 'audit_logs')?.rows).toBeGreaterThanOrEqual(1);
    expect(lines.join('\n')).not.toContain(SECRET_MARKER);
  });

  it('one run per night: a second call, from this replica or another, does nothing and logs the run that blocks it', async () => {
    expect(await runOnce()).toBeDefined();
    const tenant = await seedTenant(db.platform);
    const rows = await seedAges(tenant);
    expect(await runOnce()).toBeUndefined();
    expect(await remaining('audit_logs', [rows.old.audit_logs])).toEqual([rows.old.audit_logs]);
    const skipped = lines.map((line) => JSON.parse(line) as { event?: string; blockingRunStartedAt?: string }).find((entry) => entry.event === 'retention.run_skipped');
    expect(skipped?.blockingRunStartedAt).toEqual(expect.any(String));
  });

  it('a shutdown before the next step ends the run at once and records it as interrupted', async () => {
    const tenant = await seedTenant(db.platform);
    const rows = await seedAges(tenant);
    const stop = new AbortController();
    stop.abort();
    const summary = await runOnce(stop.signal);
    expect(summary).toMatchObject({ interrupted: true, deleted: {}, failed: [] });
    expect(await remaining('audit_logs', [rows.old.audit_logs])).toEqual([rows.old.audit_logs]);
    const finished = await db.owner.query<{ data: { interrupted: boolean } }>(`SELECT data FROM platform_audit_logs WHERE action = 'retention.run_finished' AND data ->> 'runId' = $1`, [summary!.runId]);
    expect(finished.rows[0]?.data.interrupted).toBe(true);
  });

  it('one tenant’s cleanup never touches another tenant’s young rows, even when only one tenant has old data', async () => {
    const [withOld, withYoungOnly] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    const oldRows = await seedAges(withOld);
    const youngRows = (await seedAges(withYoungOnly)).young;
    const youngOfOther = Object.entries(youngRows);
    await runOnce();
    for (const [table, id] of youngOfOther) expect(await remaining(table, [id]), table).toEqual([id]);
    expect(await remaining('audit_logs', [oldRows.old.audit_logs])).toEqual([]);
    const counts = await db.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1`, [withYoungOnly.tenantId]);
    expect(counts.rows[0]!.n).toBe(1);
  });
});
