import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, seedTenant, seedTicket, type SeededTenant } from './support/fixtures.js';

describe('claim_sla_warnings', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const claim = (limit = 1000) => withoutContext(db.worker, async (client) => (await client.query<{ n: number }>('SELECT claim_sla_warnings($1) AS n', [limit])).rows[0]!.n);

  /** A running clock that started `startedAgo` ago and is due `dueIn` from now; `columns`/`values` add to the insert. */
  const seedClock = async (tenant: SeededTenant, startedAgo: string, dueIn: string, columns = '', values = '') => {
    const ticket = await seedTicket(db.platform, tenant);
    const visitId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, sla_value, sla_unit) VALUES ($1, $2, $3, 1, 8, 'BUSINESS_HOURS') RETURNING id`,
      [tenant.tenantId, ticket.ticketId, ticket.taskStepId],
    );
    const clockId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, loop, company_id, responsible_id, sla_value, sla_unit, started_at, due_at${columns})
       VALUES ($1, $2, $3, $4, 1, $5, $6, 8, 'BUSINESS_HOURS', now() - $7::interval, now() + $8::interval${values}) RETURNING id`,
      [tenant.tenantId, ticket.ticketId, visitId, ticket.taskStepId, tenant.companyId, tenant.userId, startedAgo, dueIn],
    );
    return { ticket, visitId, clockId };
  };
  const warned = async (clockId: string) => (await db.platform.query<{ warned_at: Date | null }>('SELECT warned_at FROM ticket_sla_clocks WHERE id = $1', [clockId])).rows[0]!.warned_at;
  const events = async (clockId: string) =>
    (await db.platform.query<{ tenant_id: string; payload: Record<string, unknown> }>(`SELECT tenant_id, payload FROM outbox_events WHERE type = 'sla.warning' AND payload->>'clockId' = $1`, [clockId])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });
  afterAll(() => db.close());

  it('warns the clocks past 80 % of their window, each event in its own tenant outbox', async () => {
    // 9 h of a 10 h window (90 %) and 3 h of a 4 h window (75 %).
    const late = await seedClock(tenantA, '9 hours', '1 hour');
    const other = await seedClock(tenantB, '9 hours', '1 hour');
    const early = await seedClock(tenantA, '3 hours', '1 hour');
    await claim();
    expect(await warned(late.clockId)).not.toBeNull();
    expect((await events(late.clockId))[0]).toMatchObject({ tenant_id: tenantA.tenantId, payload: { clockId: late.clockId, ticketId: late.ticket.ticketId, responsibleId: tenantA.userId } });
    expect((await events(other.clockId))[0]!.tenant_id).toBe(tenantB.tenantId);
    expect(await warned(early.clockId)).toBeNull();
    expect(await events(early.clockId)).toHaveLength(0);
  });

  it('warns a clock once', async () => {
    const { clockId } = await seedClock(tenantA, '9 hours', '1 hour');
    await claim();
    await claim();
    expect(await events(clockId)).toHaveLength(1);
  });

  it('never warns a clock that is already overdue, alerted, paused or completed', async () => {
    const overdue = await seedClock(tenantA, '9 hours', '-1 hour');
    const alerted = await seedClock(tenantA, '9 hours', '1 hour', ', alerted_at', ', now()');
    const paused = await seedClock(tenantA, '9 hours', '1 hour', ', paused_at', ', now()');
    const completed = await seedClock(tenantA, '9 hours', '1 hour', ', completed_at, result, completion_reason', ", now(), 'ON_TIME', 'STEP_EXITED'");
    await claim();
    for (const { clockId } of [overdue, alerted, paused, completed]) expect(await events(clockId)).toHaveLength(0);
  });

  it('skips the tenants pending deletion', async () => {
    const tenant = await seedTenant(db.platform);
    const { clockId } = await seedClock(tenant, '9 hours', '1 hour');
    const requester = await insertReturningId(db.platform, `INSERT INTO users (email, first_name, last_name) VALUES ('sla-warn-' || gen_random_uuid() || '@example.com', 'Op', 'Erator') RETURNING id`, []);
    await db.owner.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [requester]);
    await db.owner.query(`UPDATE tenants SET status = 'PENDING_DELETION', deletion_requested_at = now(), deletion_requested_by_id = $2, purge_after = now() + interval '30 days' WHERE id = $1`, [tenant.tenantId, requester]);
    await claim();
    expect(await events(clockId)).toHaveLength(0);
  });

  it('honours the batch limit and is callable by the worker only', async () => {
    await seedClock(tenantA, '9 hours', '1 hour');
    await seedClock(tenantA, '9 hours', '1 hour');
    expect(await claim(1)).toBe(1);
    expect(await sqlStateOf(() => withoutContext(db.runtime, (client) => client.query('SELECT claim_sla_warnings(10)')))).toBe(SqlState.insufficientPrivilege);
  });
});
