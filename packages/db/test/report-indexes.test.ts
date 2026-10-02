import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { seedTenant, type SeededTenant } from './support/fixtures.js';

describe('report support: indexes and error type rule', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });
  afterAll(async () => {
    await db.close();
  });

  it('the date columns the reports range over are indexed', async () => {
    const { rows } = await db.platform.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [['tickets_closed_at', 'sla_clocks_completed', 'step_visits_exited', 'ticket_incidents_tenant_id_opened_at_idx', 'ticket_errors_tenant_id_created_at_idx']],
    );
    expect(rows.map((row) => row.indexname).sort()).toEqual(['sla_clocks_completed', 'step_visits_exited', 'ticket_errors_tenant_id_created_at_idx', 'ticket_incidents_tenant_id_opened_at_idx', 'tickets_closed_at']);
  });

  it.each([
    ['ticket_sla_clocks', 'completed_at', 'sla_clocks_completed'],
    ['ticket_step_visits', 'exited_at', 'step_visits_exited'],
    ['tickets', 'closed_at', 'tickets_closed_at'],
    ['ticket_incidents', 'opened_at', 'ticket_incidents_tenant_id_opened_at_idx'],
    ['ticket_errors', 'created_at', 'ticket_errors_tenant_id_created_at_idx'],
  ])('a range on %s.%s is served by %s', async (table, column, index) => {
    const client = await db.platform.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN SELECT 1 FROM ${table} WHERE tenant_id = $1 AND ${column} >= $2 AND ${column} < $3`, [tenant.tenantId, '2026-09-01', '2026-10-01']);
      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(index);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  describe('an error type is not both a reopening and a forced close', () => {
    const insert = (isReopening: boolean, forcesClose: boolean) =>
      db.platform.query(`INSERT INTO error_types (tenant_id, name, is_reopening, forces_close) VALUES ($1, $2, $3, $4)`, [tenant.tenantId, randomUUID(), isReopening, forcesClose]);

    it('accepts either flag alone', async () => {
      await insert(true, false);
      await insert(false, true);
      await insert(false, false);
    });

    it('refuses both at once, on insert and on update', async () => {
      expect(await sqlStateOf(() => insert(true, true))).toBe(SqlState.checkViolation);
      await insert(true, false);
      expect(await sqlStateOf(() => db.platform.query(`UPDATE error_types SET forces_close = true WHERE tenant_id = $1 AND is_reopening`, [tenant.tenantId]))).toBe(SqlState.checkViolation);
    });
  });
});
