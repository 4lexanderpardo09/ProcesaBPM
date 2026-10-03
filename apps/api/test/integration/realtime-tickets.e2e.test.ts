import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SubscribeAck, TicketChangedPayload, TicketRealtimeSummary } from '@procesabpm/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { SignalRouter } from '../../src/modules/realtime/application/signal-router.js';
import { SocketRevalidator } from '../../src/modules/realtime/application/socket-revalidator.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { connected, connectSocket, emitWithAck, nextEvent, nextEventWhere, notifySignal, recordEvents, startListening } from '../support/realtime-client.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

const MAX_SUBSCRIPTIONS = 3;
useTestEnvironment({ REALTIME_MAX_TICKET_SUBSCRIPTIONS: String(MAX_SUBSCRIPTIONS) });

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

interface Tenant {
  readonly world: TicketWorld;
  readonly flow: PublishedFlow;
  readonly requester: Member;
  readonly worker: Member;
}

describe('realtime tickets and notifications: subscriptions and per-recipient authorized fan-out', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let url: string;
  let mail: MailWorker;
  let a: Tenant;
  let b: Tenant;
  const sockets: Socket[] = [];

  const setUpTenant = async (): Promise<Tenant> => {
    const world = await TicketWorld.create(db, app);
    const requester = await world.member([...REQUESTER_GRANTS, grant('comment')]);
    const worker = await world.member(WORKER_GRANTS);
    const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(worker)] }));
    return { world, flow, requester, worker };
  };
  const open = async (member: Member): Promise<Socket> => {
    const socket = connectSocket(url, member.client.accessToken);
    sockets.push(socket);
    await connected(socket);
    return socket;
  };
  const create = async (tenant: Tenant) => (await tenant.requester.client.post('/tickets', { subcategoryId: tenant.flow.subcategoryId, title: unique('Ticket'), values: {} }).expect(201)).body as { id: string; openVisitId: string };
  const done = (tenant: Tenant, ticket: { id: string; openVisitId: string }) => tenant.worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: tenant.flow.transition.Done!, visitId: ticket.openVisitId, values: {} }).expect(200);
  const subscribe = (socket: Socket, ticketId: string) => emitWithAck<SubscribeAck>(socket, 'ticket.subscribe', { ticketId });
  const routerIdle = () => app.get(SignalRouter).whenIdle();
  const signal = (payload: Record<string, unknown>) => notifySignal(inject('runtimeUrl'), payload);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    url = await startListening(app);
    mail = await MailWorker.start();
    a = await setUpTenant();
    b = await setUpTenant();
    // Whatever the setup queued (invitations, nothing else) is delivered before the tests start.
    await mail.deliver();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('ticket.subscribe', () => {
    it('a readable ticket answers its summary: state and assignee ids, no content', async () => {
      const ticket = await create(a);
      const ack = await subscribe(await open(a.requester), ticket.id);
      expect(ack).toEqual({ ok: true, summary: { ticketId: ticket.id, status: expect.any(String), currentStepId: a.flow.step.task, currentLoop: expect.any(Number), assignees: [{ userId: a.worker.userId, type: expect.any(String) }], lastEventSeq: expect.stringMatching(/^\d+$/) } });
      expect(Object.keys((ack as { summary: TicketRealtimeSummary }).summary).sort()).toEqual(['assignees', 'currentLoop', 'currentStepId', 'lastEventSeq', 'status', 'ticketId']);
    });

    it('an unreadable ticket of the same tenant, another tenant\'s ticket and a missing one all answer NOT_FOUND', async () => {
      const ticket = await create(a);
      const outsider = await a.world.member([grant('read_created')]);
      expect(await subscribe(await open(outsider), ticket.id)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await subscribe(await open(b.requester), ticket.id)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await subscribe(await open(a.requester), randomUUID())).toEqual({ ok: false, code: 'NOT_FOUND' });
    });

    it(`at most ${MAX_SUBSCRIPTIONS} tickets per socket; a malformed body is VALIDATION_FAILED`, async () => {
      const socket = await open(a.requester);
      for (let index = 0; index < MAX_SUBSCRIPTIONS; index += 1) expect(await subscribe(socket, (await create(a)).id)).toMatchObject({ ok: true });
      expect(await subscribe(socket, (await create(a)).id)).toEqual({ ok: false, code: 'TOO_MANY_SUBSCRIPTIONS' });
      expect(await emitWithAck(socket, 'ticket.subscribe', { ticketId: 'nope' })).toEqual({ ok: false, code: 'VALIDATION_FAILED' });
      expect(await emitWithAck(socket, 'ticket.unsubscribe', { ticketId: randomUUID() })).toEqual({ ok: true });
    });
  });

  describe('fan-out', () => {
    it('a change reaches the subscribers who may read the ticket, with the new state; an unsubscribed socket gets nothing', async () => {
      const ticket = await create(a);
      const requesterSocket = await open(a.requester);
      const workerSocket = await open(a.worker);
      const before = (await subscribe(requesterSocket, ticket.id)) as { summary: TicketRealtimeSummary };
      await subscribe(workerSocket, ticket.id);
      expect(await emitWithAck(workerSocket, 'ticket.unsubscribe', { ticketId: ticket.id })).toEqual({ ok: true });
      const workerEvents = recordEvents(workerSocket);
      const changed = nextEventWhere<TicketChangedPayload>(requesterSocket, 'ticket.changed', (event) => event.summary.status !== before.summary.status);
      await done(a, ticket);
      await mail.deliver();
      const payload = await changed;
      expect(payload.ticketId).toBe(ticket.id);
      expect(payload.kinds.length).toBeGreaterThan(0);
      expect(payload.summary.status).not.toBe(before.summary.status);
      expect(BigInt(payload.summary.lastEventSeq)).toBeGreaterThan(BigInt(before.summary.lastEventSeq));
      await routerIdle();
      expect(workerEvents.filter(([event]) => event === 'ticket.changed')).toEqual([]);
    });

    it('a subscriber who lost access is told once and receives nothing more about the ticket', async () => {
      const observer = await a.world.member([grant('read_observed')]);
      const observerLink = (await a.world.admin.post(`/workflows/${a.flow.workflowId}/observers`, user(observer)).expect(201)).body as { id: string };
      const ticket = await create(a);
      const observerSocket = await open(observer);
      expect(await subscribe(observerSocket, ticket.id)).toMatchObject({ ok: true });
      await a.world.admin.delete(`/workflows/${a.flow.workflowId}/observers/${observerLink.id}`).expect(204);

      const received = recordEvents(observerSocket);
      const lost = nextEvent<{ ticketId: string }>(observerSocket, 'ticket.access_lost');
      await done(a, ticket);
      await mail.deliver();
      expect(await lost).toEqual({ ticketId: ticket.id });
      await routerIdle();
      expect(received.filter(([event]) => event === 'ticket.changed')).toEqual([]);
    });

    it('the sweep drops a subscription that became unreadable without any change to the ticket', async () => {
      const observer = await a.world.member([grant('read_observed')]);
      const observerLink = (await a.world.admin.post(`/workflows/${a.flow.workflowId}/observers`, user(observer)).expect(201)).body as { id: string };
      const ticket = await create(a);
      const socket = await open(observer);
      expect(await subscribe(socket, ticket.id)).toMatchObject({ ok: true });
      await a.world.admin.delete(`/workflows/${a.flow.workflowId}/observers/${observerLink.id}`).expect(204);
      const lost = nextEvent<{ ticketId: string }>(socket, 'ticket.access_lost');
      await app.get(SocketRevalidator).sweepNow();
      expect(await lost).toEqual({ ticketId: ticket.id });
    });

    it('notifications.changed carries the unread counter of the person, read as that person', async () => {
      const [tab1, tab2] = [await open(a.worker), await open(a.worker)];
      const requesterEvents = recordEvents(await open(a.requester));
      const first = nextEvent<{ unreadCount: number }>(tab1, 'notifications.changed');
      const second = nextEvent<{ unreadCount: number }>(tab2, 'notifications.changed');
      await create(a);
      await mail.deliver();
      const expected = (await a.worker.client.get('/notifications/unread-count').expect(200)).body.count as number;
      expect((await first).unreadCount).toBe(expected);
      expect((await second).unreadCount).toBe(expected);
      await routerIdle();
      expect(requesterEvents.filter(([event]) => event === 'notifications.changed')).toEqual([]);

      // A bare signal (as the worker sends it) is only a hint: the counter is read fresh from the database.
      const again = nextEvent<{ unreadCount: number }>(tab1, 'notifications.changed');
      await signal({ v: 1, k: 'notifications', t: a.world.tenant.tenantId, u: [a.worker.userId] });
      expect((await again).unreadCount).toBe(expected);
    });
  });

  describe('tenant isolation (leak test)', () => {
    it('a socket of tenant B never receives anything about tenant A, even with forged signals', async () => {
      const ticketA = await create(a);
      const ticketB = await create(b);
      await mail.deliver();
      const bSockets = [await open(b.requester), await open(b.worker)];
      expect(await subscribe(bSockets[0]!, ticketB.id)).toMatchObject({ ok: true });
      expect(await subscribe(bSockets[1]!, ticketA.id)).toEqual({ ok: false, code: 'NOT_FOUND' });
      const bEvents = bSockets.map(recordEvents);
      const aSocket = await open(a.requester);
      await subscribe(aSocket, ticketA.id);

      const tenantA = a.world.tenant.tenantId;
      const tenantB = b.world.tenant.tenantId;
      // Real activity in tenant A.
      const aChanged = nextEvent<TicketChangedPayload>(aSocket, 'ticket.changed');
      await done(a, ticketA);
      await mail.deliver();
      expect((await aChanged).ticketId).toBe(ticketA.id);
      // Forged signals that mix the tenants: ids of one tenant under the other's id, B's people under A.
      for (const forged of [
        { v: 1, k: 'ticket', t: tenantB, id: ticketA.id, e: 'ticket.closed' },
        { v: 1, k: 'ticket', t: tenantA, id: ticketB.id, e: 'ticket.closed' },
        { v: 1, k: 'document', t: tenantB, id: ticketA.id, d: randomUUID() },
        { v: 1, k: 'notifications', t: tenantA, u: [b.requester.userId, b.worker.userId] },
        { v: 1, k: 'access', t: tenantB },
      ]) {
        await signal(forged);
      }
      // A positive control after the forged signals: when it arrives, everything before it was processed.
      const control = nextEvent<{ unreadCount: number }>(aSocket, 'notifications.changed');
      await signal({ v: 1, k: 'notifications', t: tenantA, u: [a.requester.userId] });
      await control;
      await routerIdle();

      for (const events of bEvents) expect(events).toEqual([]);
      for (const socket of bSockets) expect(socket.connected).toBe(true);
    });
  });
});
