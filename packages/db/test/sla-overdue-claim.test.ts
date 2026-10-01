import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, seedTicket, type SeededTenant } from './support/fixtures.js';

describe('claim_overdue_sla_clocks', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const claim = (limit = 1000) => withoutContext(db.worker, async (client) => (await client.query<{ n: number }>('SELECT claim_overdue_sla_clocks($1) AS n', [limit])).rows[0]!.n);

  /** A ticket with an open visit and one running clock due `dueIn` from now (negative: already overdue). */
  const seedClock = async (tenant: SeededTenant, dueIn: string, extra = '') => {
    const ticket = await seedTicket(db.platform, tenant);
    const visitId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, sla_value, sla_unit) VALUES ($1, $2, $3, 1, 8, 'BUSINESS_HOURS') RETURNING id`,
      [tenant.tenantId, ticket.ticketId, ticket.taskStepId],
    );
    const clockId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, loop, company_id, responsible_id, sla_value, sla_unit, started_at, due_at ${extra.split('|')[0] ?? ''})
       VALUES ($1, $2, $3, $4, 1, $5, $6, 8, 'BUSINESS_HOURS', now() - interval '2 days', now() + $7::interval ${extra.split('|')[1] ?? ''}) RETURNING id`,
      [tenant.tenantId, ticket.ticketId, visitId, ticket.taskStepId, tenant.companyId, tenant.userId, dueIn],
    );
    return { ticket, visitId, clockId };
  };
  const alerted = async (clockId: string) => (await db.platform.query<{ alerted_at: Date | null }>('SELECT alerted_at FROM ticket_sla_clocks WHERE id = $1', [clockId])).rows[0]!.alerted_at;
  const events = async (clockId: string) =>
    (await db.platform.query<{ tenant_id: string; payload: Record<string, unknown> }>(`SELECT tenant_id, payload FROM outbox_events WHERE type = 'sla.overdue' AND payload->>'clockId' = $1`, [clockId])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  it('alerts overdue clocks of every tenant, each event in its own tenant outbox', async () => {
    const [a, b] = [await seedClock(tenantA, '-1 hour'), await seedClock(tenantB, '-2 hours')];

    expect(await claim()).toBeGreaterThanOrEqual(2);

    expect(await alerted(a.clockId)).not.toBeNull();
    expect(await alerted(b.clockId)).not.toBeNull();
    const [eventA] = await events(a.clockId);
    expect(eventA!.tenant_id).toBe(tenantA.tenantId);
    expect(eventA!.payload).toMatchObject({ clockId: a.clockId, ticketId: a.ticket.ticketId, visitId: a.visitId, stepId: a.ticket.taskStepId, loop: 1, responsibleId: tenantA.userId });
    expect((await events(b.clockId))[0]!.tenant_id).toBe(tenantB.tenantId);
  });

  it('alerts a clock only once', async () => {
    const { clockId } = await seedClock(tenantA, '-1 hour');
    await claim();
    await claim();
    expect(await events(clockId)).toHaveLength(1);
  });

  it('skips clocks that are not due yet, completed or paused', async () => {
    const future = await seedClock(tenantA, '1 hour');
    const paused = await seedClock(tenantA, '-1 hour', ', paused_at|, now()');
    const completed = await seedClock(tenantA, '-1 hour', ', completed_at, result|, now(), \'LATE\'');
    await claim();
    for (const { clockId } of [future, paused, completed]) {
      expect(await alerted(clockId)).toBeNull();
      expect(await events(clockId)).toHaveLength(0);
    }
  });

  it('honours the batch limit', async () => {
    await seedClock(tenantA, '-3 hours');
    await seedClock(tenantA, '-3 hours');
    expect(await claim(1)).toBe(1);
  });

  it('is callable by the worker only', async () => {
    const asRuntime = () => withoutContext(db.runtime, (client) => client.query('SELECT claim_overdue_sla_clocks(10)'));
    expect(await sqlStateOf(asRuntime)).toBe(SqlState.insufficientPrivilege);
  });
});
