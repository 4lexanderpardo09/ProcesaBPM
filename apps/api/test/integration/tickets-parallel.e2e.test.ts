import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, SUPERVISOR_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const signer = (member: Member) => ({ signerType: 'USER', userId: member.userId });
const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('PARALLEL assignment: everybody signs, the first rejection decides', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let a: Member;
  let b: Member;
  let c: Member;
  let supervisor: Member;
  let flow: PublishedFlow;
  let approvalFlow: PublishedFlow;
  let noRejection: PublishedFlow;
  let ending: PublishedFlow;

  const create = (target: PublishedFlow, as = requester) => as.client.post('/tickets', { subcategoryId: target.subcategoryId, title: 'Request', values: {} });
  const sign = (as: { client: Member['client'] }, ticket: { id: string; openVisitId: string }, body: Record<string, unknown> = {}) => as.client.post(`/tickets/${ticket.id}/parallel-tasks/sign`, { visitId: ticket.openVisitId, ...body });
  const reject = (as: { client: Member['client'] }, ticket: { id: string; openVisitId: string }, body: Record<string, unknown> = {}) => as.client.post(`/tickets/${ticket.id}/parallel-tasks/reject`, { visitId: ticket.openVisitId, ...body });
  const tasks = async (ticketId: string) => (await db.platform.query(`SELECT user_id, status, completed_at FROM ticket_parallel_tasks WHERE ticket_id = $1 ORDER BY user_id`, [ticketId])).rows as Array<{ user_id: string; status: string; completed_at: Date | null }>;
  const taskStatus = async (ticketId: string, member: Member) => (await tasks(ticketId)).find((task) => task.user_id === member.userId)?.status;
  const spec = (signers: ReadonlyArray<Record<string, unknown>>, options: { rejection?: boolean; type?: 'TASK' | 'APPROVAL'; sla?: boolean; end?: boolean } = {}): FlowSpec => {
    const withRejection = options.rejection !== false;
    const toEnd = options.end === true;
    return {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'sign', type: options.type ?? 'TASK', extra: { assignmentMode: 'PARALLEL', ...(options.sla === false ? {} : { slaValue: 8, slaUnit: 'BUSINESS_HOURS' }) }, signers },
        ...(toEnd ? [] : [{ key: 'next', type: 'TASK' as const, extra: { assignmentMode: 'CREATOR' } }]),
        ...(withRejection ? [{ key: 'rejected', type: 'TASK' as const, extra: { assignmentMode: 'CREATOR' } }] : []),
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'sign', type: 'DEFAULT' },
        { from: 'sign', to: toEnd ? 'end' : 'next', type: 'DECISION', label: 'Signed' },
        ...(withRejection ? [{ from: 'sign', to: 'rejected', type: 'SYSTEM_ONLY' as const, label: 'Rejected' }, { from: 'rejected', to: 'end', type: 'DECISION' as const, label: 'Closed' }] : []),
        ...(toEnd ? [] : [{ from: 'next', to: 'end', type: 'DECISION' as const, label: 'Done' }]),
      ],
    };
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([...REQUESTER_GRANTS, grant('transition'), grant('read_assigned')]);
    [a, b, c] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    supervisor = await world.member([...SUPERVISOR_GRANTS]);
    flow = await publishFlow(world.admin, spec([signer(a), signer(b)]));
    approvalFlow = await publishFlow(world.admin, spec([signer(a), signer(b)], { type: 'APPROVAL' }));
    noRejection = await publishFlow(world.admin, spec([signer(a), signer(b)], { rejection: false }));
    ending = await publishFlow(world.admin, spec([signer(a), signer(b)], { end: true }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('arrival', () => {
    it('creates one signature, one assignment and one clock per signer, in a single visit', async () => {
      const ticket = (await create(flow).then((r) => (expect(r.status).toBe(201), r))).body;
      expect(await tasks(ticket.id)).toEqual([a, b].map((member) => ({ user_id: member.userId, status: 'PENDING', completed_at: null })).sort((x, y) => (x.user_id < y.user_id ? -1 : 1)));
      expect((await world.assignees(ticket.id)).map((row) => row.type)).toEqual(['PARALLEL', 'PARALLEL']);
      expect((await world.clocks(ticket.id)).map((clock) => clock.responsible_id).sort()).toEqual([a.userId, b.userId].sort());
      expect(await world.visits(ticket.id)).toHaveLength(1);
      const detail = (await a.client.get(`/tickets/${ticket.id}`).expect(200)).body;
      expect(detail.parallelTasks.map((task: { status: string }) => task.status)).toEqual(['PENDING', 'PENDING']);
    });

    it('resolves a position to its least loaded holder, repeats a person once, and a signer nobody can be fails everything', async () => {
      const position = await world.position();
      const [busy, free] = [await world.member(WORKER_GRANTS, { positionId: position }), await world.member(WORKER_GRANTS, { positionId: position })];
      await create(await publishFlow(world.admin, spec([signer(busy)], { sla: false }))).then((r) => expect(r.status).toBe(201));
      const positional = await publishFlow(world.admin, spec([{ signerType: 'POSITION', positionId: position }, { signerType: 'CREATOR' }, signer(a), signer(a)]));
      const ticket = (await create(positional)).body;
      const people = (await tasks(ticket.id)).map((task) => task.user_id).sort();
      expect(people).toEqual([free.userId, requester.userId, a.userId].sort());

      const emptyPosition = await publishFlow(world.admin, spec([{ signerType: 'POSITION', positionId: await world.position() }]));
      const before = Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
      const refused = await create(emptyPosition);
      expect([refused.status, refused.body.error.code]).toEqual([422, 'NO_ASSIGNEE_CANDIDATES']);
      expect(Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n)).toBe(before);
      void busy;
    });
  });

  describe('signing', () => {
    it('everybody must sign: each signature closes only the signer\'s clock, the last one advances the step', async () => {
      const ticket = (await create(flow)).body;
      const first = await sign(a, ticket, { comment: 'Fine' });
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ currentStepId: flow.step.sign, openVisitId: ticket.openVisitId });
      expect(await taskStatus(ticket.id, a)).toBe('SIGNED');
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: b.userId, type: 'PARALLEL' }]);
      const clocks = await world.clocks(ticket.id);
      expect(clocks.map((clock) => [clock.responsible_id === a.userId, clock.completed_at !== null, clock.result !== null])).toContainEqual([true, true, true]);
      expect(clocks.find((clock) => clock.responsible_id === b.userId)!.completed_at).toBeNull();

      const last = await sign(b, ticket).expect(200);
      expect(last.body).toMatchObject({ status: 'OPEN', currentStepId: flow.step.next });
      expect(last.body.openVisitId).not.toBe(ticket.openVisitId);
      expect((await world.visits(ticket.id)).map((visit) => [visit.step_id, visit.exited_at !== null, visit.exit_transition_id])).toEqual([[flow.step.sign, true, flow.transition.Signed], [flow.step.next, false, null]]);
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: requester.userId, type: 'PRIMARY' }]);
      expect((await world.clocks(ticket.id)).filter((clock) => clock.step_id === flow.step.sign).every((clock) => clock.completed_at !== null)).toBe(true);
      const events = await world.events(ticket.id);
      expect(events.filter((event) => event.type === 'PARALLEL_TASK_COMPLETED').map((event) => [event.assignee_id, event.data?.status])).toEqual([[a.userId, 'SIGNED'], [b.userId, 'SIGNED']]);
      expect(events.find((event) => event.type === 'TRANSITIONED' && event.actor_id === b.userId)?.data).toEqual({ parallelOutcome: 'APPROVED' });
      expect(await world.outbox('ticket.parallel_task_completed', ticket.id)).toHaveLength(2);
    });

    it('when the way out is the end, the last signature closes the ticket', async () => {
      const ticket = (await create(ending)).body;
      await sign(a, ticket).expect(200);
      const done = await sign(b, ticket).expect(200);
      expect(done.body).toMatchObject({ status: 'CLOSED', openVisitId: null });
      expect(await world.ticketRow(ticket.id)).toMatchObject({ status: 'CLOSED', closed_by_id: b.userId });
    });

    it('only a signer signs, and only once', async () => {
      const ticket = (await create(flow)).body;
      expect((await sign(c, ticket)).status).toBe(404);
      const reader = await world.member([grant('read_all')]);
      expect((await sign(reader, ticket)).status).toBe(403);
      await sign(a, ticket).expect(200);
      const twice = await sign(a, ticket);
      expect([twice.status, twice.body.error.code]).toEqual([409, 'PARALLEL_TASK_NOT_PENDING']);
    });

    it('a stale visit is refused', async () => {
      const ticket = (await create(flow)).body;
      expect((await sign(a, { ...ticket, openVisitId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' })).status).toBe(409);
    });

    it('the last two signatures at the same time: one waits, one advances, once (10 rounds)', async () => {
      for (let round = 0; round < 10; round += 1) {
        const ticket = (await create(flow)).body;
        const results = await Promise.all([sign(a, ticket), sign(b, ticket)]);
        expect(results.map((result) => result.status), `round ${round}`).toEqual([200, 200]);
        expect((await tasks(ticket.id)).map((task) => task.status)).toEqual(['SIGNED', 'SIGNED']);
        expect((await world.visits(ticket.id)).map((visit) => visit.step_id)).toEqual([flow.step.sign, flow.step.next]);
        expect((await world.events(ticket.id)).filter((event) => event.type === 'TRANSITIONED' && event.actor_id !== null)).toHaveLength(1);
        expect((await world.clocks(ticket.id)).filter((clock) => clock.completed_at === null)).toHaveLength(1);
      }
    });
  });

  describe('rejecting', () => {
    it('the first rejection cancels the pending signatures, closes their clocks and leaves through the rejection exit', async () => {
      const ticket = (await create(flow)).body;
      const rejected = await reject(a, ticket, { comment: 'No' }).expect(200);
      expect(rejected.body.currentStepId).toBe(flow.step.rejected);
      expect([await taskStatus(ticket.id, a), await taskStatus(ticket.id, b)]).toEqual(['REJECTED', 'CANCELLED']);
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: requester.userId, type: 'PRIMARY' }]);
      expect((await world.clocks(ticket.id)).filter((clock) => clock.step_id === flow.step.sign).every((clock) => clock.completed_at !== null)).toBe(true);
      expect((await world.visits(ticket.id))[0]).toMatchObject({ exit_transition_id: flow.transition.Rejected });
      const events = await world.events(ticket.id);
      expect(events.filter((event) => event.type === 'PARALLEL_TASK_COMPLETED').map((event) => event.data?.status).sort()).toEqual(['CANCELLED', 'REJECTED']);
      expect(events.find((event) => event.type === 'TRANSITIONED' && event.actor_id === a.userId)?.data).toEqual({ parallelOutcome: 'REJECTED' });
      expect((await sign(b, ticket)).status).toBe(409);
    });

    it('a step without a rejection exit cannot be rejected', async () => {
      const ticket = (await create(noRejection)).body;
      const refused = await reject(a, ticket);
      expect([refused.status, refused.body.error.code]).toEqual([422, 'REJECTION_NOT_ALLOWED']);
      expect(await taskStatus(ticket.id, a)).toBe('PENDING');
    });

    it('an approval step asks for a comment when rejecting (one that sanitizes to nothing is none)', async () => {
      const ticket = (await create(approvalFlow)).body;
      const refused = await reject(a, ticket);
      expect([refused.status, refused.body.error.code]).toEqual([422, 'COMMENT_REQUIRED']);
      expect((await reject(a, ticket, { comment: '<script>x</script>' })).body.error.code).toBe('COMMENT_REQUIRED');
      await reject(a, ticket, { comment: 'Because' }).expect(200);
    });

    it('a signature and a rejection at the same time leave a consistent ticket (10 rounds)', async () => {
      for (let round = 0; round < 10; round += 1) {
        const ticket = (await create(flow)).body;
        const results = await Promise.all([sign(a, ticket), reject(b, ticket, { comment: 'No' })]);
        const statuses = results.map((result) => result.status).sort();
        expect(statuses, `round ${round}`).toEqual(expect.arrayContaining([200]));
        expect((await world.ticketRow(ticket.id)).current_step_id).toBe(flow.step.rejected);
        expect((await tasks(ticket.id)).every((task) => task.status !== 'PENDING')).toBe(true);
        expect((await world.visits(ticket.id)).filter((visit) => visit.exited_at === null)).toHaveLength(1);
      }
    });
  });

  describe('interactions', () => {
    it('a supervisor can move a parallel step on, cancelling what is pending; a signer cannot use transition', async () => {
      const ticket = (await create(flow)).body;
      const asSigner = await a.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Signed, visitId: ticket.openVisitId });
      expect(asSigner.status).toBe(403);
      const moved = await supervisor.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Signed, visitId: ticket.openVisitId });
      expect(moved.status).toBe(200);
      expect(moved.body.currentStepId).toBe(flow.step.next);
      expect((await tasks(ticket.id)).map((task) => task.status)).toEqual(['CANCELLED', 'CANCELLED']);
      expect((await world.events(ticket.id)).find((event) => event.type === 'TRANSITIONED' && event.actor_id === supervisor.userId)?.data).toMatchObject({ parallelOverride: true });
    });

    it('a signature can be passed to someone else with reassign + fromUserId', async () => {
      const ticket = (await create(flow)).body;
      const reassign = (body: Record<string, unknown>) => supervisor.client.post(`/tickets/${ticket.id}/reassign`, { visitId: ticket.openVisitId, ...body });
      expect((await reassign({ toUserId: c.userId })).status).toBe(422);
      expect((await reassign({ toUserId: b.userId, fromUserId: a.userId })).status).toBe(422);
      expect((await reassign({ toUserId: c.userId, fromUserId: c.userId })).status).toBe(422);
      await reassign({ toUserId: c.userId, fromUserId: a.userId }).then((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));
      expect((await tasks(ticket.id)).map((task) => task.user_id).sort()).toEqual([b.userId, c.userId].sort());
      const open = (await world.clocks(ticket.id)).filter((clock) => clock.completed_at === null).map((clock) => clock.responsible_id).sort();
      expect(open).toEqual([b.userId, c.userId].sort());
      expect((await sign(a, ticket)).status).toBe(403);
      await sign(c, ticket).expect(200);
      await sign(b, ticket).expect(200);
    });

    it('an incident cannot hand a parallel step to a named person: the signatures would be left pending', async () => {
      const opener = await world.member([...WORKER_GRANTS, grant('open_incident')]);
      const incidentFlow = await publishFlow(world.admin, spec([signer(opener), signer(b)]));
      const ticket = (await create(incidentFlow)).body;
      const incident = (await opener.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: c.userId, description: 'Paused' }).expect(201)).body;
      const refused = await supervisor.client.post(`/tickets/${ticket.id}/incidents/${incident.incidentId}/resolve`, { resolution: 'x', assigneeId: a.userId });
      expect([refused.status, refused.body.error.code]).toEqual([422, 'INVALID_ASSIGNEE']);
    });

    it('reopening into a parallel step asks its signers again, and nobody can be named for it', async () => {
      const ticket = (await create(ending)).body;
      await sign(a, ticket).expect(200);
      await sign(b, ticket).expect(200);
      const errorType = (await db.platform.query(`INSERT INTO error_types (tenant_id, name, is_reopening) VALUES ($1, $2, true) RETURNING id`, [world.tenant.tenantId, `Reopen ${Math.random()}`])).rows[0].id as string;
      const reopener = await world.member([...SUPERVISOR_GRANTS, grant('reopen')]);
      const body = { errorTypeId: errorType, description: 'Again', responsibleId: a.userId };
      expect((await reopener.client.post(`/tickets/${ticket.id}/reopen`, { ...body, assigneeId: c.userId })).status).toBe(422);
      const reopened = await reopener.client.post(`/tickets/${ticket.id}/reopen`, body);
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect((await world.assignees(ticket.id)).map((row) => row.type)).toEqual(['PARALLEL', 'PARALLEL']);
      const fresh = (await db.platform.query(`SELECT status FROM ticket_parallel_tasks WHERE ticket_id = $1 AND loop = 2 ORDER BY user_id`, [ticket.id])).rows;
      expect(fresh.map((row) => row.status)).toEqual(['PENDING', 'PENDING']);
      await sign(a, reopened.body).expect(200);
      expect((await sign(b, reopened.body).expect(200)).body.status).toBe('CLOSED');
    });

    it('a parallel step cannot be closed by hand', async () => {
      const ticket = (await create(flow)).body;
      const supervisorCloser = await world.member([...SUPERVISOR_GRANTS, grant('close')]);
      const refused = await supervisorCloser.client.post(`/tickets/${ticket.id}/close`, { visitId: ticket.openVisitId });
      expect(refused.status).toBeGreaterThanOrEqual(403);
      expect((await world.ticketRow(ticket.id)).status).toBe('OPEN');
    });

    it('an incident gives the pending signatures back to their signers', async () => {
      const opener = await world.member([...WORKER_GRANTS, grant('open_incident')]);
      const incidentFlow = await publishFlow(world.admin, spec([signer(opener), signer(b)]));
      const ticket = (await create(incidentFlow)).body;
      await sign(b, ticket).expect(200);
      const incident = await opener.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: c.userId, description: 'Paused' });
      expect(incident.status, JSON.stringify(incident.body)).toBe(201);
      expect((await world.ticketRow(ticket.id)).status).toBe('PAUSED');
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: c.userId, type: 'INCIDENT' }]);
      await c.client.post(`/tickets/${ticket.id}/incidents/${incident.body.incidentId}/resolve`, { resolution: 'Back' }).then((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));
      // Only the signature still pending comes back, as a signature.
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: opener.userId, type: 'PARALLEL' }]);
      await sign(opener, ticket).expect(200);
    });
  });

  describe('isolation', () => {
    it('another tenant cannot sign or reject', async () => {
      const foreign = await TicketWorld.create(db, app);
      const ticket = (await create(flow)).body;
      expect((await sign({ client: foreign.admin }, ticket)).status).toBe(404);
      expect((await reject({ client: foreign.admin }, ticket, { comment: 'x' })).status).toBe(404);
      expect((await tasks(ticket.id)).every((task) => task.status === 'PENDING')).toBe(true);
    });
  });
});
