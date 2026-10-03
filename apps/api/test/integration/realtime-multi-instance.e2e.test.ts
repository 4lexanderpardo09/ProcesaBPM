import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { SubscribeAck, TicketChangedPayload } from '@procesabpm/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConnectionRegistry } from '../../src/modules/realtime/application/connection-registry.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { seedUser } from '../support/auth-fixtures.js';
import { signIn } from '../support/auth-helpers.js';
import { connected, connectSocket, emitWithAck, nextEvent, nextEventWhere, startListening } from '../support/realtime-client.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('realtime with two API instances', () => {
  let db: TestDatabase;
  let first: INestApplication;
  let second: INestApplication;
  let firstUrl: string;
  let secondUrl: string;
  let mail: MailWorker;
  let flow: PublishedFlow;
  let requester: Member;
  let worker: Member;
  const sockets: Socket[] = [];

  const open = async (url: string, member: Member): Promise<Socket> => {
    const socket = connectSocket(url, member.client.accessToken);
    sockets.push(socket);
    await connected(socket);
    return socket;
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app: first } = await createTestApp());
    ({ app: second } = await createTestApp());
    [firstUrl, secondUrl] = [await startListening(first), await startListening(second)];
    mail = await MailWorker.start();
    const world = await TicketWorld.create(db, first);
    requester = await world.member([...REQUESTER_GRANTS, grant('comment')]);
    worker = await world.member(WORKER_GRANTS);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [{ participantType: 'USER', userId: worker.userId }] }));
    await mail.deliver();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await mail.close();
    await Promise.all([first.close(), second.close()]);
    await db.close();
  });

  it('a change made through one instance reaches the subscribers connected to both', async () => {
    const ticket = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Ticket'), values: {} }).expect(201)).body as { id: string; openVisitId: string };
    const [onFirst, onSecond] = [await open(firstUrl, requester), await open(secondUrl, requester)];
    for (const socket of [onFirst, onSecond]) expect(await emitWithAck<SubscribeAck>(socket, 'ticket.subscribe', { ticketId: ticket.id })).toMatchObject({ ok: true });
    const arrivals = [onFirst, onSecond].map((socket) => nextEventWhere<TicketChangedPayload>(socket, 'ticket.changed', (event) => event.ticketId === ticket.id));
    await worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId, values: {} }).expect(200);
    await mail.deliver();
    const payloads = await Promise.all(arrivals);
    expect(payloads[0]!.summary).toEqual(payloads[1]!.summary);
  });

  it('a logout on one instance ends the socket held by the other (the trigger signal reaches every instance)', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const signedIn = await signIn(first, user.email, tenant.tenantId);
    const socket = connectSocket(secondUrl, signedIn.accessToken);
    sockets.push(socket);
    await connected(socket);
    const required = nextEvent<{ reason: string }>(socket, 'auth.required');
    await request(first.getHttpServer()).post('/auth/logout').set('cookie', signedIn.refreshCookie).expect(204);
    expect((await required).reason).toBe('SESSION_CHANGED');
  });

  it('a message over the size limit closes the socket and leaves nothing behind', async () => {
    const member = await TicketWorld.create(db, first).then((world) => world.member([grant('read_created')]));
    const socket = await open(firstUrl, member);
    const closed = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    socket.emit('ticket.subscribe', { ticketId: 'x'.repeat(32 * 1024) }, () => undefined);
    expect(await closed).toBeDefined();
    await expect.poll(() => first.get(ConnectionRegistry).stats().sockets).toBe(0);
  });

  it('two hundred connect/disconnect cycles leave no sockets, rooms or timers behind', async () => {
    const member = await TicketWorld.create(db, first).then((world) => world.member([grant('read_created')]));
    for (let batch = 0; batch < 20; batch += 1) {
      const opened = await Promise.all(Array.from({ length: 10 }, () => open(batch % 2 === 0 ? firstUrl : secondUrl, member)));
      for (const socket of opened) socket.disconnect();
    }
    await expect.poll(() => first.get(ConnectionRegistry).stats().sockets + second.get(ConnectionRegistry).stats().sockets, { timeout: 20_000 }).toBe(0);
    expect(first.get(ConnectionRegistry).stats()).toEqual({ sockets: 0, sessions: 0, rooms: 0, timers: 0 });
    expect(second.get(ConnectionRegistry).stats()).toEqual({ sockets: 0, sessions: 0, rooms: 0, timers: 0 });
  });
});
