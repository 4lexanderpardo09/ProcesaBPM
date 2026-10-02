import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, insertStep, insertTicket, publishVersion, seedDraftWorkflow, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('WAIT block: parked visits and claim_due_waits', () => {
  let db: TestDatabase;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  const claim = (limit = 1000) => withoutContext(db.worker, async (client) => (await client.query<{ n: number }>('SELECT claim_due_waits($1) AS n', [limit])).rows[0]!.n);

  /** A published flow with a WAIT step and an OPEN ticket on it; the visit resumes `resumeIn` from now. */
  const seedParked = async (tenant: SeededTenant, resumeIn = '-1 hour', status: 'OPEN' | 'CLOSED' = 'OPEN') => {
    const workflow = await seedDraftWorkflow(db.platform, tenant);
    const waitStepId = await insertStep(db.platform, tenant.tenantId, workflow.versionId, { type: 'WAIT', name: 'Wait' });
    await publishVersion(db.platform, tenant.tenantId, workflow.versionId);
    const ticketId = await insertTicket(db.platform, tenant, { ...workflow, taskStepId: waitStepId });
    const visitId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, resume_at) VALUES ($1, $2, $3, 1, now() + $4::interval) RETURNING id`,
      [tenant.tenantId, ticketId, waitStepId, resumeIn],
    );
    if (status === 'CLOSED') await db.platform.query(`UPDATE tickets SET status = 'CLOSED', closed_at = now(), closed_by_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, ticketId, tenant.userId]);
    return { workflow, waitStepId, ticketId, visitId };
  };
  const events = async (visitId: string) => (await db.platform.query<{ tenant_id: string; payload: Record<string, unknown> }>(`SELECT tenant_id, payload FROM outbox_events WHERE type = 'ticket.wait_elapsed' AND payload->>'visitId' = $1`, [visitId])).rows;
  const stamped = async (visitId: string) => (await db.platform.query<{ resume_enqueued_at: Date | null }>('SELECT resume_enqueued_at FROM ticket_step_visits WHERE id = $1', [visitId])).rows[0]!.resume_enqueued_at;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenantA, tenantB] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });

  afterAll(async () => {
    await db.close();
  });

  describe('integrity', () => {
    it('a visit of a WAIT step must be parked and a visit of any other step must not', async () => {
      const parked = await seedParked(tenantA, '1 hour');
      const noResume = () => db.platform.query(`INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop) VALUES ($1, $2, $3, 2)`, [tenantA.tenantId, parked.ticketId, parked.waitStepId]);
      expect(await sqlStateOf(noResume)).toBe(SqlState.checkViolation);
      const onTask = () => db.platform.query(`INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, resume_at) VALUES ($1, $2, $3, 1, now())`, [tenantA.tenantId, parked.ticketId, parked.workflow.startStepId]);
      expect(await sqlStateOf(onTask)).toBe(SqlState.checkViolation);
    });

    it('a parked visit has no SLA and no clocks', async () => {
      const parked = await seedParked(tenantA, '1 hour');
      await db.platform.query('UPDATE ticket_step_visits SET exited_at = now() WHERE id = $1', [parked.visitId]);
      const withSla = () =>
        db.platform.query(`INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop, resume_at, sla_value, sla_unit) VALUES ($1, $2, $3, 2, now(), 8, 'BUSINESS_HOURS')`, [tenantA.tenantId, parked.ticketId, parked.waitStepId]);
      expect(await sqlStateOf(withSla)).toBe(SqlState.checkViolation);

      const open = await seedParked(tenantA, '1 hour');
      const clock = () =>
        db.platform.query(
          `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, loop, company_id, responsible_id, sla_value, sla_unit, started_at, due_at)
           VALUES ($1, $2, $3, $4, 1, $5, $6, 8, 'BUSINESS_HOURS', now(), now() + interval '1 hour')`,
          [tenantA.tenantId, open.ticketId, open.visitId, open.waitStepId, tenantA.companyId, tenantA.userId],
        );
      expect(await sqlStateOf(clock)).toBe(SqlState.checkViolation);
    });

    it('the enqueue stamp needs a resume time', async () => {
      const parked = await seedParked(tenantA, '1 hour');
      const stamp = () => db.platform.query('UPDATE ticket_step_visits SET resume_at = NULL, resume_enqueued_at = now() WHERE id = $1', [parked.visitId]);
      expect(await sqlStateOf(stamp)).toBe(SqlState.checkViolation);
    });
  });

  describe('claim_due_waits', () => {
    it('wakes the due visits of every tenant, each event in its own tenant outbox', async () => {
      const [a, b] = [await seedParked(tenantA), await seedParked(tenantB, '-2 hours')];
      expect(await claim()).toBeGreaterThanOrEqual(2);
      expect(await stamped(a.visitId)).not.toBeNull();
      expect(await stamped(b.visitId)).not.toBeNull();
      expect((await events(a.visitId))[0]).toMatchObject({ tenant_id: tenantA.tenantId, payload: { ticketId: a.ticketId, visitId: a.visitId, stepId: a.waitStepId } });
      expect((await events(b.visitId))[0]!.tenant_id).toBe(tenantB.tenantId);
    });

    it('wakes a visit only once', async () => {
      const { visitId } = await seedParked(tenantA);
      await claim();
      await claim();
      expect(await events(visitId)).toHaveLength(1);
    });

    it('skips visits that are not due, exited, or of tickets that are not open', async () => {
      const future = await seedParked(tenantA, '1 hour');
      const closed = await seedParked(tenantA, '-1 hour', 'CLOSED');
      const exited = await seedParked(tenantA);
      await db.platform.query('UPDATE ticket_step_visits SET exited_at = now() WHERE id = $1', [exited.visitId]);
      await claim();
      for (const { visitId } of [future, closed, exited]) {
        expect(await stamped(visitId)).toBeNull();
        expect(await events(visitId)).toHaveLength(0);
      }
    });

    it('wakes a rescheduled visit again (the retry after a configuration error)', async () => {
      const { visitId } = await seedParked(tenantA);
      await claim();
      await db.platform.query(`UPDATE ticket_step_visits SET resume_at = now() - interval '1 minute', resume_enqueued_at = NULL WHERE id = $1`, [visitId]);
      await claim();
      expect(await events(visitId)).toHaveLength(2);
    });

    it('two workers at once never take the same visit', async () => {
      const seeded = [];
      for (let index = 0; index < 6; index += 1) seeded.push(await seedParked(tenantA));
      const taken = (await Promise.all([claim(), claim(), claim()])).reduce((sum, n) => sum + n, 0);
      expect(taken).toBeGreaterThanOrEqual(6);
      for (const { visitId } of seeded) expect(await events(visitId)).toHaveLength(1);
    });

    it('honours the batch limit', async () => {
      await seedParked(tenantA);
      await seedParked(tenantA);
      expect(await claim(1)).toBe(1);
    });

    it('is callable by the worker only', async () => {
      const asRuntime = () => withoutContext(db.runtime, (client) => client.query('SELECT claim_due_waits(10)'));
      expect(await sqlStateOf(asRuntime)).toBe(SqlState.insufficientPrivilege);
    });
  });
});
