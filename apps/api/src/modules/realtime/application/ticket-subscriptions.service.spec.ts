import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { AbilityService } from '../../authorization/application/ability.service.js';
import type { TicketVisibility } from '../../tickets/application/ticket-visibility.js';
import { RoomNames } from '../domain/room-names.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { RealtimeEmitter } from './realtime-emitter.js';
import type { SessionGate } from './session-gate.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';
import { TicketSubscriptionsService } from './ticket-subscriptions.service.js';

const principal: Principal = { userId: 'u', tenantId: 't', sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } };
const summaryOf = (ticketId: string) => ({ ticketId, status: 'OPEN', currentStepId: null, currentLoop: 1, assignees: [], lastEventSeq: '1' });

function setUp(max = 2) {
  const joined: string[] = [];
  const socket = { id: 'socket', data: { session: new SocketSession(principal, new Date(Date.now() + 60_000), 0, '127.0.0.1') }, join: (room: string) => joined.push(room), leave: vi.fn() } as unknown as RealtimeSocket;
  const session = socket.data.session!;
  const gate = { verify: () => Promise.resolve(session.principal) } as unknown as SessionGate;
  const abilities = { forPrincipal: () => Promise.resolve({}) } as unknown as AbilityService;
  const reads: Array<() => void> = [];
  const visibility = { summaryIfReadable: (_principal: Principal, _ability: unknown, ticketId: string) => new Promise((resolve) => reads.push(() => resolve(summaryOf(ticketId)))) } as unknown as TicketVisibility;
  const emitter = { emit: vi.fn() } as unknown as RealtimeEmitter;
  const service = new TicketSubscriptionsService({ REALTIME_MAX_TICKET_SUBSCRIPTIONS: max }, gate, abilities, visibility, new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 4 }), emitter);
  /** Answers the pending reads once `count` of them are waiting. */
  const settle = async (count = 1) => {
    await vi.waitFor(() => expect(reads.length).toBe(count));
    for (const read of reads.splice(0)) read();
  };
  return { service, socket, session, joined, settle };
}

describe('TicketSubscriptionsService', () => {
  it('subscribes to a readable ticket and joins its room', async () => {
    const { service, socket, joined, settle } = setUp();
    const pending = service.subscribe(socket, 'a');
    await settle();
    expect((await pending).ack).toEqual({ ok: true, summary: summaryOf('a') });
    expect(joined).toEqual([RoomNames.ticket('t', 'a')]);
  });

  it('concurrent subscriptions cannot exceed the cap', async () => {
    const { service, socket, session, settle } = setUp(2);
    const pending = ['a', 'b', 'c'].map((ticketId) => service.subscribe(socket, ticketId));
    await settle(3);
    const acks = (await Promise.all(pending)).map((outcome) => outcome.ack);
    expect(acks.filter((ack) => ack.ok)).toHaveLength(2);
    expect(acks.filter((ack) => !ack.ok)).toEqual([{ ok: false, code: 'TOO_MANY_SUBSCRIPTIONS' }]);
    expect(session.tickets.size).toBe(2);
  });

  it('a session that entered reauth while the ticket was read gets no summary and joins nothing', async () => {
    const { service, socket, session, joined, settle } = setUp();
    const pending = service.subscribe(socket, 'a');
    session.state = 'reauth';
    await settle();
    expect((await pending).ack).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(joined).toEqual([]);
    expect(session.tickets.size).toBe(0);
  });

  it('a session refreshed while the ticket was read is not trusted with the answer', async () => {
    const { service, socket, session, settle } = setUp();
    const pending = service.subscribe(socket, 'a');
    session.principal = { ...principal, sessionId: 's2' };
    await settle();
    expect((await pending).ack).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
  });
});
