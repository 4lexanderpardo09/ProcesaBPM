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

describe('RANDOM_DISPATCH: waiting tickets are handed out round-robin by the worker', () => {
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

  it('hands the waiting tickets out in turn, keeping the clock start, with events and outbox', async () => {
    const step = flow.step.task!;
    const tickets = [];
    for (let index = 0; index < 4; index += 1) tickets.push((await create()).body);
    await letIntervalPass(step);
    const result = await dispatchAll();
    expect(result.failed).toBe(0);
    const owners = [];
    for (const ticket of tickets) owners.push((await holder(ticket.id))[0]);
    // Oldest first, in id order of the candidates, wrapping around (earlier tests may have moved the pointer).
    const ids = people.map((person) => person.userId);
    const start = ids.indexOf(owners[0]!);
    expect(owners).toEqual([0, 1, 2, 3].map((offset) => ids[(start + offset) % 3]!));
    const [clock] = await world.clocks(tickets[0].id);
    expect(clock).toMatchObject({ responsible_id: owners[0], completed_at: null });
    expect((await world.events(tickets[0].id)).at(-1)).toMatchObject({ type: 'ASSIGNED', actor_id: null, assignee_id: owners[0], data: { assigneeType: 'PRIMARY', dispatched: true } });
    expect(await world.outbox('ticket.assigned', tickets[0].id)).toHaveLength(1);
    const pointer = (await db.platform.query(`SELECT last_assigned_user_id FROM step_runtime_states WHERE step_id = $1`, [step])).rows[0].last_assigned_user_id;
    expect(pointer).toBe(owners[3]);
    expect((await requester.client.get(`/tickets/${tickets[0].id}`).expect(200)).body.awaitingDispatch).toBe(false);
  });

  it('continues where it stopped, and does nothing until the interval passes', async () => {
    const step = flow.step.task!;
    const ids = people.map((person) => person.userId);
    const a = (await create()).body;
    await letIntervalPass(step);
    await dispatchAll();
    const [ownerA] = await holder(a.id);

    const b = (await create()).body;
    await dispatchAll();
    expect(await holder(b.id)).toEqual([]);
    await letIntervalPass(step);
    await dispatchAll();
    expect(await holder(b.id)).toEqual([ids[(ids.indexOf(ownerA!) + 1) % 3]!]);
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

  it('serves each tenant with its own people and its own pointer', async () => {
    const other = await TicketWorld.create(db, app);
    const [theirRequester, theirWorker] = [await other.member(REQUESTER_GRANTS), await other.member(WORKER_GRANTS)];
    const theirs = await publishFlow(other.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, { candidates: [user(theirWorker)] }));
    const theirTicket = (await theirRequester.client.post('/tickets', { subcategoryId: theirs.subcategoryId, title: 'x', values: {} }).expect(201)).body;
    const mine = (await create()).body;
    const pointerBefore = (await db.platform.query(`SELECT last_assigned_user_id FROM step_runtime_states WHERE step_id = $1`, [flow.step.task])).rows[0]?.last_assigned_user_id;
    await letIntervalPass(flow.step.task!);
    await db.platform.query(`UPDATE step_runtime_states SET last_dispatch_at = NULL WHERE step_id = $1`, [theirs.step.task]);
    await dispatchAll();
    expect((await db.platform.query(`SELECT user_id FROM ticket_assignees WHERE ticket_id = $1`, [theirTicket.id])).rows.map((row) => row.user_id)).toEqual([theirWorker.userId]);
    expect(people.map((person) => person.userId)).toContain((await holder(mine.id))[0]);
    expect((await db.platform.query(`SELECT last_assigned_user_id FROM step_runtime_states WHERE step_id = $1`, [theirs.step.task])).rows[0].last_assigned_user_id).toBe(theirWorker.userId);
    void pointerBefore;
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
