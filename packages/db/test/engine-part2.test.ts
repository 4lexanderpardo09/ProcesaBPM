import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, withoutContext, type TestDatabase } from './support/database.js';
import { insertReturningId, insertTicket, publishVersion, seedDraftWorkflow, seedMember, seedTenant, withPlatformTransaction, type SeededTenant } from './support/fixtures.js';

describe('parallel cancellation and random dispatch', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let other: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
  });
  afterAll(async () => {
    await db.close();
  });

  /** A ticket on a published version whose `task` step is RANDOM_DISPATCH, with an open visit. */
  const dispatchTicket = async (owner: SeededTenant, interval = 5) => {
    const workflow = await seedDraftWorkflow(db.platform, owner);
    await db.platform.query(`UPDATE steps SET assignment_mode = 'RANDOM_DISPATCH', dispatch_interval_min = $1 WHERE tenant_id = $2 AND id = $3`, [interval, owner.tenantId, workflow.taskStepId]);
    await publishVersion(db.platform, owner.tenantId, workflow.versionId);
    const ticketId = await insertTicket(db.platform, owner, workflow);
    const visitId = await insertReturningId(db.platform, `INSERT INTO ticket_step_visits (tenant_id, ticket_id, step_id, loop) VALUES ($1, $2, $3, 1) RETURNING id`, [owner.tenantId, ticketId, workflow.taskStepId]);
    const clockId = await insertReturningId(
      db.platform,
      `INSERT INTO ticket_sla_clocks (tenant_id, ticket_id, visit_id, step_id, loop, company_id, started_at) VALUES ($1, $2, $3, $4, 1, $5, now()) RETURNING id`,
      [owner.tenantId, ticketId, visitId, workflow.taskStepId, owner.companyId],
    );
    return { ...workflow, ticketId, clockId };
  };
  const claim = (limit = 1000) => withoutContext(db.worker, async (client) => (await client.query<{ out_tenant_id: string; out_step_id: string }>('SELECT * FROM claim_random_dispatch_steps($1)', [limit])).rows);

  describe('parallel tasks', () => {
    const seedParallel = async () => {
      const ticket = await dispatchTicket(tenant);
      const signer = await seedMember(db.platform, tenant);
      await db.platform.query(`INSERT INTO ticket_assignees (tenant_id, ticket_id, user_id, type) VALUES ($1, $2, $3, 'PARALLEL')`, [tenant.tenantId, ticket.ticketId, signer]);
      await db.platform.query(`INSERT INTO ticket_parallel_tasks (tenant_id, ticket_id, step_id, user_id) VALUES ($1, $2, $3, $4)`, [tenant.tenantId, ticket.ticketId, ticket.taskStepId, signer]);
      return { ticket, signer };
    };

    it('a cancelled task stops holding the ticket, like a signed one', async () => {
      const { ticket, signer } = await seedParallel();
      await db.platform.query(`UPDATE ticket_parallel_tasks SET status = 'CANCELLED', completed_at = now() WHERE tenant_id = $1 AND ticket_id = $2`, [tenant.tenantId, ticket.ticketId]);
      expect((await db.platform.query('SELECT 1 FROM ticket_assignees WHERE ticket_id = $1 AND user_id = $2', [ticket.ticketId, signer])).rowCount).toBe(0);
    });

    it('a ticket with only cancelled tasks can close', async () => {
      const { ticket } = await seedParallel();
      await withPlatformTransaction(db.platform, async (tx) => {
        await tx.query(`UPDATE ticket_parallel_tasks SET status = 'CANCELLED', completed_at = now() WHERE tenant_id = $1 AND ticket_id = $2`, [tenant.tenantId, ticket.ticketId]);
        await tx.query(`UPDATE tickets SET status = 'CLOSED', closed_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, ticket.ticketId]);
      });
      expect((await db.platform.query('SELECT status FROM tickets WHERE id = $1', [ticket.ticketId])).rows[0].status).toBe('CLOSED');
    });

    it('a task is pending exactly until it has a completion time', async () => {
      const { ticket } = await seedParallel();
      const complete = (status: string, completedAt: string) => () =>
        db.platform.query(`UPDATE ticket_parallel_tasks SET status = $3, completed_at = ${completedAt} WHERE tenant_id = $1 AND ticket_id = $2`, [tenant.tenantId, ticket.ticketId, status]);
      expect(await sqlStateOf(complete('SIGNED', 'NULL'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(complete('PENDING', 'now()'))).toBe(SqlState.checkViolation);
    });
  });

  describe('claim_random_dispatch_steps', () => {
    it('claims the step with a waiting ticket, of its own tenant, and stamps the dispatch time', async () => {
      const ticket = await dispatchTicket(tenant);
      const claimed = await claim();
      expect(claimed).toContainEqual({ out_tenant_id: tenant.tenantId, out_step_id: ticket.taskStepId });
      const state = await db.platform.query('SELECT last_dispatch_at FROM step_runtime_states WHERE tenant_id = $1 AND step_id = $2', [tenant.tenantId, ticket.taskStepId]);
      expect(state.rows[0].last_dispatch_at).not.toBeNull();
    });

    it('waits for the interval, then claims again', async () => {
      const ticket = await dispatchTicket(tenant, 5);
      await claim();
      expect((await claim()).map((row) => row.out_step_id)).not.toContain(ticket.taskStepId);
      await db.platform.query(`UPDATE step_runtime_states SET last_dispatch_at = now() - interval '6 minutes' WHERE tenant_id = $1 AND step_id = $2`, [tenant.tenantId, ticket.taskStepId]);
      expect((await claim()).map((row) => row.out_step_id)).toContain(ticket.taskStepId);
    });

    it('ignores steps whose waiting clocks are assigned, paused or completed', async () => {
      const assigned = await dispatchTicket(tenant);
      await db.platform.query(`UPDATE ticket_sla_clocks SET responsible_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, assigned.clockId, tenant.userId]);
      const paused = await dispatchTicket(tenant);
      await db.platform.query(`UPDATE ticket_sla_clocks SET paused_at = now() WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, paused.clockId]);
      const done = await dispatchTicket(tenant);
      await db.platform.query(`UPDATE ticket_sla_clocks SET completed_at = now(), completion_reason = 'STEP_EXITED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, done.clockId]);
      const steps = (await claim()).map((row) => row.out_step_id);
      for (const ticket of [assigned, paused, done]) expect(steps).not.toContain(ticket.taskStepId);
    });

    it('claims the steps of every tenant, each tagged with its own tenant', async () => {
      const [a, b] = [await dispatchTicket(tenant), await dispatchTicket(other)];
      const claimed = await claim();
      expect(claimed).toContainEqual({ out_tenant_id: tenant.tenantId, out_step_id: a.taskStepId });
      expect(claimed).toContainEqual({ out_tenant_id: other.tenantId, out_step_id: b.taskStepId });
    });

    it('two workers at once never claim the same step', async () => {
      const tickets: Array<Awaited<ReturnType<typeof dispatchTicket>>> = [];
      for (let index = 0; index < 6; index += 1) tickets.push(await dispatchTicket(tenant));
      const [first, second] = await Promise.all([claim(), claim()]);
      const mine = (rows: typeof first) => rows.map((row) => row.out_step_id).filter((id) => tickets.some((ticket) => ticket.taskStepId === id));
      expect([...mine(first), ...mine(second)].sort()).toEqual(tickets.map((ticket) => ticket.taskStepId).sort());
    });

    it('is callable by the worker only', async () => {
      const asRuntime = () => withoutContext(db.runtime, (client) => client.query('SELECT * FROM claim_random_dispatch_steps(10)'));
      expect(await sqlStateOf(asRuntime)).toBe(SqlState.insufficientPrivilege);
    });
  });
});
