import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { RandomDispatchJob } from '../../src/modules/engine/application/random-dispatch.job.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('RANDOM_DISPATCH: the worker hands waiting tickets out by load, batches whole', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let worker: TestingModule;
  let world: TicketWorld;
  let requester: Member;
  let people: Member[];
  let supervisor: Member;
  let flow: PublishedFlow;
  let job: RandomDispatchJob;

  const create = (target = flow, as = requester) => as.client.post('/tickets', { subcategoryId: target.subcategoryId, title: 'Request', values: {} }).expect(201);
  const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
  const holder = async (ticketId: string) => (await world.assignees(ticketId)).map((row) => row.user_id);
  /** The claim stamps the step with the database clock: letting the interval pass is done by moving the stamp back. */
  const letIntervalPass = (stepId: string) => db.platform.query(`UPDATE step_runtime_states SET last_dispatch_at = now() - interval '1 hour' WHERE step_id = $1`, [stepId]);
  const dispatchAll = () => job.runOnce();

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
    await worker.init();
    job = worker.get(RandomDispatchJob);
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    people = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    people.sort((a, b) => (a.userId < b.userId ? -1 : 1));
    supervisor = await world.member(SUPERVISOR_GRANTS);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5, slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { candidates: people.map(user) }));
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await db.close();
  });

  it('arrives unassigned: no assignee, a running clock nobody owns, a SYSTEM event', async () => {
    const ticket = (await create()).body;
    expect(await world.assignees(ticket.id)).toEqual([]);
    expect((await world.clocks(ticket.id)).map((clock) => [clock.responsible_id, clock.completed_at])).toEqual([[null, null]]);
    expect((await world.events(ticket.id)).at(-1)).toMatchObject({ type: 'SYSTEM', data: { kind: 'AWAITING_DISPATCH' } });
    const detail = (await requester.client.get(`/tickets/${ticket.id}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'OPEN', awaitingDispatch: true });
  });

  it('hands the waiting tickets out evenly, keeping the clock start, with events and outbox', async () => {
    const crew = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    const even = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5, slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { candidates: crew.map(user) }));
    const tickets = [];
    for (let index = 0; index < 6; index += 1) tickets.push((await create(even)).body);
    await letIntervalPass(even.step.task!).catch(() => undefined);
    const result = await dispatchAll();
    expect(result.failed).toBe(0);
    const owners: string[] = [];
    for (const ticket of tickets) owners.push((await holder(ticket.id))[0]!);
    expect(crew.map((person) => owners.filter((owner) => owner === person.userId).length)).toEqual([2, 2, 2]);
    const [clock] = await world.clocks(tickets[0].id);
    expect(clock).toMatchObject({ responsible_id: owners[0], completed_at: null });
    expect((await world.events(tickets[0].id)).at(-1)).toMatchObject({ type: 'ASSIGNED', actor_id: null, assignee_id: owners[0], data: { assigneeType: 'PRIMARY', dispatched: true } });
    expect(await world.outbox('ticket.assigned', tickets[0].id)).toHaveLength(1);
    expect((await requester.client.get(`/tickets/${tickets[0].id}`).expect(200)).body.awaitingDispatch).toBe(false);
  });

  it('the one with fewer open tickets in the step gets the next, and nothing moves until the interval passes', async () => {
    const [x, y] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    const pair = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, { candidates: [x, y].map(user) }));
    const [first, second] = [(await create(pair)).body, (await create(pair)).body];
    await letIntervalPass(pair.step.task!).catch(() => undefined);
    await dispatchAll();
    const done = (await holder(first.id))[0] === y.userId ? first : second;
    await y.client.post(`/tickets/${done.id}/transition`, { transitionId: pair.transition.Done, visitId: done.openVisitId, values: {} }).then((response) => expect(response.status, JSON.stringify(response.body)).toBe(200));

    const next = (await create(pair)).body;
    await dispatchAll();
    expect(await holder(next.id)).toEqual([]);
    await letIntervalPass(pair.step.task!);
    await dispatchAll();
    expect(await holder(next.id)).toEqual([y.userId]);
  });

  it('tickets answered together in a batch go whole to one person; one answered alone is on its own', async () => {
    const clerk = await world.member(WORKER_GRANTS);
    const crew = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    const payments = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'collect', type: 'TASK', extra: { assignmentMode: 'USERS', allowsBatch: true, config: { batch: { maxTickets: 10 } } }, candidates: [user(clerk)] },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, candidates: crew.map(user) },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'collect', type: 'DEFAULT' },
        { from: 'collect', to: 'review', type: 'DECISION', label: 'Send' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Approve' },
      ],
    });
    const tickets = [];
    for (let index = 0; index < 4; index += 1) tickets.push((await create(payments)).body);
    const [alone, ...together] = tickets;
    const moved = await clerk.client.post('/ticket-batches/transition', { transitionId: payments.transition.Send, items: together.map((ticket) => ({ ticketId: ticket.id, visitId: ticket.openVisitId })), values: {} }).expect(200);
    expect(moved.body.results.every((result: { ok: boolean }) => result.ok)).toBe(true);
    await clerk.client.post(`/tickets/${alone.id}/transition`, { transitionId: payments.transition.Send, visitId: alone.openVisitId, values: {} }).expect(200);
    const batchOf = async (ticketId: string) => (await db.platform.query(`SELECT batch_id FROM tickets WHERE id = $1`, [ticketId])).rows[0].batch_id as string | null;
    const batchIds = await Promise.all(together.map((ticket) => batchOf(ticket.id)));
    expect(new Set(batchIds).size).toBe(1);
    expect(batchIds[0]).not.toBeNull();
    expect(await batchOf(alone.id)).toBeNull();

    await letIntervalPass(payments.step.review!).catch(() => undefined);
    await dispatchAll();
    const owners = await Promise.all(together.map(async (ticket) => (await holder(ticket.id))[0]));
    expect(new Set(owners).size).toBe(1);
    const [aloneOwner] = await holder(alone.id);
    expect(aloneOwner).toBeDefined();
    expect(aloneOwner).not.toBe(owners[0]);

    // Moving on alone clears the batch: it holds together only until each ticket moves by itself.
    const owner = crew.find((person) => person.userId === owners[0])!;
    // The dispatch gives the ticket a person within the same visit the batch opened.
    const visitId = (moved.body.results as Array<{ ticketId: string; ticket: { openVisitId: string } }>).find((result) => result.ticketId === together[0]!.id)!.ticket.openVisitId;
    await owner.client.post(`/tickets/${together[0]!.id}/transition`, { transitionId: payments.transition.Approve, visitId, values: {} }).expect(200);
    expect(await batchOf(together[0]!.id)).toBeNull();
  });

  it('a person who is no longer eligible is skipped', async () => {
    const [x, y] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    const small = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, { candidates: [x, y].map(user) }));
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, x.userId]);
    const ticket = (await create(small)).body;
    await letIntervalPass(small.step.task!).catch(() => undefined);
    await dispatchAll();
    expect(await holder(ticket.id)).toEqual([y.userId]);
  });

  it('paused tickets are not dispatched; resolving the incident puts them back in line', async () => {
    const opener = await world.member([...WORKER_GRANTS, { action: 'open_incident', subject: 'Ticket' }, ...SUPERVISOR_GRANTS.filter((grant) => grant.action === 'reassign' || grant.action === 'read_all')]);
    const ticket = (await create()).body;
    const incident = await opener.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: people[0]!.userId, description: 'Wait' });
    expect(incident.status, JSON.stringify(incident.body)).toBe(201);
    await letIntervalPass(flow.step.task!);
    await dispatchAll();
    expect(await holder(ticket.id)).toEqual([people[0]!.userId]);
    expect((await world.assignees(ticket.id)).map((row) => row.type)).toEqual(['INCIDENT']);
    await people[0]!.client.post(`/tickets/${ticket.id}/incidents/${incident.body.incidentId}/resolve`, { resolution: 'ok' }).then((response) => expect(response.status, JSON.stringify(response.body)).toBe(200));
    expect(await world.assignees(ticket.id)).toEqual([]);
    await letIntervalPass(flow.step.task!);
    await dispatchAll();
    expect((await holder(ticket.id)).length).toBe(1);
  });

  it('nobody can take a waiting ticket, but a supervisor can reassign it', async () => {
    const ticket = (await create()).body;
    // A candidate does not even see the ticket until it is dispatched to them.
    expect((await people[0]!.client.post(`/tickets/${ticket.id}/take`, { visitId: ticket.openVisitId })).status).toBe(404);
    await supervisor.client.post(`/tickets/${ticket.id}/reassign`, { toUserId: people[1]!.userId, visitId: ticket.openVisitId }).then((response) => expect(response.status, JSON.stringify(response.body)).toBe(200));
    expect(await world.assignees(ticket.id)).toEqual([{ user_id: people[1]!.userId, type: 'PRIMARY' }]);
    await letIntervalPass(flow.step.task!);
    await dispatchAll();
    expect(await holder(ticket.id)).toEqual([people[1]!.userId]);
  });

  it('two dispatch runs at the same time assign each ticket once', async () => {
    const tickets = [];
    for (let index = 0; index < 6; index += 1) tickets.push((await create()).body);
    await letIntervalPass(flow.step.task!);
    await Promise.all([dispatchAll(), dispatchAll()]);
    for (const ticket of tickets) {
      expect(await holder(ticket.id)).toHaveLength(1);
      expect((await world.clocks(ticket.id)).filter((clock) => clock.completed_at === null)).toHaveLength(1);
    }
  });

  it('serves each tenant with its own people', async () => {
    const other = await TicketWorld.create(db, app);
    const [theirRequester, theirWorker] = [await other.member(REQUESTER_GRANTS), await other.member(WORKER_GRANTS)];
    const theirs = await publishFlow(other.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, { candidates: [user(theirWorker)] }));
    const theirTicket = (await theirRequester.client.post('/tickets', { subcategoryId: theirs.subcategoryId, title: 'x', values: {} }).expect(201)).body;
    const mine = (await create()).body;
    await letIntervalPass(flow.step.task!);
    await db.platform.query(`UPDATE step_runtime_states SET last_dispatch_at = NULL WHERE step_id = $1`, [theirs.step.task]);
    await dispatchAll();
    expect((await db.platform.query(`SELECT user_id FROM ticket_assignees WHERE ticket_id = $1`, [theirTicket.id])).rows.map((row) => row.user_id)).toEqual([theirWorker.userId]);
    expect(people.map((person) => person.userId)).toContain((await holder(mine.id))[0]);
  });

  it('a dispatched holder who is gone when their incident ends sends the ticket back to the queue', async () => {
    const holderMember = await world.member([...WORKER_GRANTS, { action: 'open_incident', subject: 'Ticket' }]);
    const handler = await world.member(WORKER_GRANTS);
    const solo = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5, slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { candidates: [user(holderMember)] }));
    const ticket = (await create(solo)).body;
    await letIntervalPass(solo.step.task!).catch(() => undefined);
    await dispatchAll();
    expect(await holder(ticket.id)).toEqual([holderMember.userId]);

    const incident = (await holderMember.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: handler.userId, description: 'Paused' }).expect(201)).body;
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, holderMember.userId]);
    await handler.client.post(`/tickets/${ticket.id}/incidents/${incident.incidentId}/resolve`, { resolution: 'ok' }).then((response) => expect(response.status, JSON.stringify(response.body)).toBe(200));
    expect(await world.assignees(ticket.id)).toEqual([]);
    expect((await world.clocks(ticket.id)).map((clock) => [clock.responsible_id, clock.completed_at])).toEqual([[null, null]]);
  });
});
