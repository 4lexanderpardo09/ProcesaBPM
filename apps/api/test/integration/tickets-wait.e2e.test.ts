import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WaitResumeJob } from '../../src/modules/engine/application/wait-resume.job.js';
import { adminOf, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

describe('WAIT blocks: parking, refusing actions, waking up', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let mail: MailWorker;
  let job: WaitResumeJob;

  const flowWith = (config: Record<string, unknown>, after: 'review' | 'end' = 'review'): FlowSpec => ({
    steps: [
      { key: 'start', type: 'START' as const },
      { key: 'wait', type: 'WAIT' as const, extra: { config } },
      ...(after === 'review' ? [{ key: 'review', type: 'TASK' as const, extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER' as const, userId: worker.userId }] }] : []),
      { key: 'end', type: 'END' as const },
    ],
    transitions: [
      { from: 'start', to: 'wait', type: 'DEFAULT' },
      { from: 'wait', to: after, type: 'DEFAULT' },
      ...(after === 'review' ? [{ from: 'review', to: 'end', type: 'DECISION' as const, label: 'Done' }] : []),
    ],
    fields: [{ step: 'start', code: 'DUE', type: 'DATE', capture: 'CREATION' }],
  });
  const create = (flow: PublishedFlow, values: Record<string, unknown> = {}) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Waiting', values });
  const visitOf = async (ticketId: string, stepId: string) =>
    (await db.platform.query(`SELECT id, resume_at, resume_enqueued_at, exited_at, exit_transition_id, sla_value, due_at FROM ticket_step_visits WHERE tenant_id = $1 AND ticket_id = $2 AND step_id = $3 ORDER BY entered_at DESC`, [world.tenant.tenantId, ticketId, stepId])).rows[0];
  const expireNow = (visitId: string) => db.platform.query(`UPDATE ticket_step_visits SET resume_at = now() - interval '1 minute' WHERE id = $1`, [visitId]);
  const wake = async () => {
    await job.runOnce();
    await mail.deliver();
  };
  const durationFlow = () => publishFlow(world.admin, flowWith({ mode: 'DURATION', value: 2, unit: 'BUSINESS_DAYS' }));

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS)];
    mail = await MailWorker.start();
    job = mail.module.get(WaitResumeJob, { strict: false });
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('parks the ticket on the block: open, a visit with a wake-up time, no clocks and nobody assigned', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    expect(created.body).toMatchObject({ status: 'OPEN', currentStepId: flow.step.wait! });
    const visit = await visitOf(created.body.id, flow.step.wait!);
    expect(created.body.openVisitId).toBe(visit.id);
    expect(visit).toMatchObject({ exited_at: null, sla_value: null, due_at: null });
    expect(visit.resume_at.getTime()).toBeGreaterThan(Date.now());
    expect(await world.clocks(created.body.id)).toEqual([]);
    expect(await world.assignees(created.body.id)).toEqual([]);
    expect((await world.events(created.body.id)).map((event) => [event.type, event.data?.kind ?? event.data?.blockType])).toEqual([['CREATED', undefined], ['TRANSITIONED', 'START'], ['SYSTEM', 'WAITING']]);
  });

  it('refuses every action on a waiting ticket, but still takes comments', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    const refused = await world.admin.post(`/tickets/${created.body.id}/transition`, { transitionId: flow.transition['wait->review'], visitId: created.body.openVisitId, values: {} }).expect(422);
    expect(refused.body.error.code).toBe('TICKET_WAITING');
    expect(refused.body.error.details.resumeAt).toEqual(expect.any(String));
    await world.admin.post(`/tickets/${created.body.id}/comments`, { comment: 'Still here' }).expect(201);
  });

  it('wakes the ticket when the time comes: closes the visit, follows the exit and assigns the next step', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    expect(await job.runOnce()).toBe(0);
    await expireNow(created.body.openVisitId);
    await wake();

    expect((await world.ticketRow(created.body.id)).current_step_id).toBe(flow.step.review!);
    expect(await visitOf(created.body.id, flow.step.wait!)).toMatchObject({ exit_transition_id: flow.transition['wait->review'] });
    expect((await visitOf(created.body.id, flow.step.wait!)).exited_at).not.toBeNull();
    expect(await world.assignees(created.body.id)).toEqual([{ user_id: worker.userId, type: 'PRIMARY' }]);
    const woke = (await world.events(created.body.id)).find((event) => event.data?.blockType === 'WAIT');
    expect(woke).toMatchObject({ type: 'TRANSITIONED', actor_id: null, step_id: flow.step.wait!, transition_id: flow.transition['wait->review'] });
    expect((await world.clocks(created.body.id)).map((clock) => clock.step_id)).toEqual([flow.step.review!]);
  });

  it('wakes a ticket once, even when the event is delivered again or two workers run together', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    await expireNow(created.body.openVisitId);
    await Promise.all([job.runOnce(), job.runOnce()]);
    await mail.deliver();
    const afterFirst = await world.events(created.body.id);

    await db.platform.query(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'ticket.wait_elapsed', $2)`, [world.tenant.tenantId, { ticketId: created.body.id, visitId: created.body.openVisitId, stepId: flow.step.wait! }]);
    await mail.deliver();
    expect(await world.events(created.body.id)).toHaveLength(afterFirst.length);
    expect((await world.events(created.body.id)).filter((event) => event.data?.blockType === 'WAIT')).toHaveLength(1);
    expect((await world.clocks(created.body.id))).toHaveLength(1);
  });

  it('a wait that leads to the end closes the ticket with nobody as closer', async () => {
    const flow = await publishFlow(world.admin, flowWith({ mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' }, 'end'));
    const created = await create(flow).expect(201);
    await expireNow(created.body.openVisitId);
    await wake();
    expect(await world.ticketRow(created.body.id)).toMatchObject({ status: 'CLOSED', closed_by_id: null, current_step_id: flow.step.end! });
    expect((await world.events(created.body.id)).map((event) => event.type)).toEqual(['CREATED', 'TRANSITIONED', 'SYSTEM', 'TRANSITIONED', 'CLOSED']);
  });

  describe('until the date of a field', () => {
    const untilFlow = () => publishFlow(world.admin, flowWith({ mode: 'UNTIL_FIELD_DATE', fieldCode: 'DUE', offsetBusinessDays: 0 }));
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it('lets the ticket straight through when the field is blank, saying so', async () => {
      const flow = await untilFlow();
      const created = await create(flow).expect(201);
      expect(created.body.currentStepId).toBe(flow.step.review!);
      expect((await world.events(created.body.id)).find((event) => event.data?.blockType === 'WAIT')?.data).toMatchObject({ automatic: true, skipped: 'FIELD_BLANK' });
    });

    it('lets the ticket through when the date has passed, and parks it when it is ahead', async () => {
      const flow = await untilFlow();
      expect((await create(flow, { DUE: inDays(-3) }).expect(201)).body.currentStepId).toBe(flow.step.review!);
      const parked = await create(flow, { DUE: inDays(10) }).expect(201);
      expect(parked.body.currentStepId).toBe(flow.step.wait!);
      expect((await visitOf(parked.body.id, flow.step.wait!)).resume_at.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('keeps the ticket waiting and records why when it cannot move on, and tries again later', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, worker.userId]);
    try {
      await expireNow(created.body.openVisitId);
      await wake();
      expect((await world.ticketRow(created.body.id)).current_step_id).toBe(flow.step.wait!);
      const visit = await visitOf(created.body.id, flow.step.wait!);
      expect(visit.exited_at).toBeNull();
      expect(visit.resume_enqueued_at).toBeNull();
      expect(visit.resume_at.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
      expect((await world.events(created.body.id)).filter((event) => event.data?.kind === 'WAIT_RESUME_FAILED').map((event) => event.data)).toEqual([{ kind: 'WAIT_RESUME_FAILED', code: 'NO_ASSIGNEE_CANDIDATES' }]);
    } finally {
      await db.platform.query(`UPDATE memberships SET status = 'ACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, worker.userId]);
    }
    await expireNow(created.body.openVisitId);
    await wake();
    expect((await world.ticketRow(created.body.id)).current_step_id).toBe(flow.step.review!);
  });

  it('never wakes or exposes the tickets of another tenant (tenant leak test)', async () => {
    const flow = await durationFlow();
    const created = await create(flow).expect(201);
    const other = await adminOf(db, app, await seedTenant(db.platform));
    await other.admin.get(`/tickets/${created.body.id}`).expect(404);
    await other.admin.post(`/tickets/${created.body.id}/comments`, { comment: 'Hello' }).expect(404);
    await expireNow(created.body.openVisitId);
    await wake();
    const events = await db.platform.query(`SELECT tenant_id FROM outbox_events WHERE type = 'ticket.wait_elapsed' AND payload->>'ticketId' = $1`, [created.body.id]);
    expect(events.rows.map((row) => row.tenant_id)).toEqual([world.tenant.tenantId]);
  });
});
