import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import type { RealtimeSignal } from '../../../infrastructure/realtime/realtime-signal.js';
import type { RealtimeSignalSource } from '../../../infrastructure/realtime/realtime-signal-source.js';
import type { NotificationsService } from '../../notifications/application/notifications.service.js';
import { RoomNames } from '../domain/room-names.js';
import type { ConnectionRegistry } from './connection-registry.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { RealtimeEmitter } from './realtime-emitter.js';
import type { SessionGate } from './session-gate.js';
import { SignalRouter, workOf } from './signal-router.js';
import type { SocketRevalidator } from './socket-revalidator.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';
import type { TicketSubscriptionsService } from './ticket-subscriptions.service.js';

const T = '0199a000-0000-7000-8000-00000000000a';
const OTHER_T = '0199a000-0000-7000-8000-00000000000b';
const U = '0199a000-0000-7000-8000-00000000000c';
const TICKET = '0199a000-0000-7000-8000-00000000000d';
const FILE = '0199a000-0000-7000-8000-00000000000e';

const principalOf = (sessionId: string, tenantId = T, userId = U): Principal => ({ userId, tenantId, sessionId, roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } });
const socketOf = (principal: Principal, accepted = true) =>
  ({ id: Math.random().toString(36), accepted, data: { session: new SocketSession(principal, new Date(), 0, '127.0.0.1') } }) as unknown as RealtimeSocket & { accepted: boolean };
const summary = { ticketId: TICKET, status: 'OPEN', currentStepId: null, currentLoop: 1, assignees: [], lastEventSeq: '7' };

function setUp(rooms: Record<string, RealtimeSocket[]>, options: { queueMax?: number; readable?: boolean } = {}) {
  let onSignal!: (signal: RealtimeSignal) => void;
  let onGap!: () => void;
  const source = { onSignal: (listener: typeof onSignal) => (onSignal = listener), onGap: (listener: typeof onGap) => (onGap = listener) } as unknown as RealtimeSignalSource;
  const all = [...new Set(Object.values(rooms).flat())];
  const registry = { socketsIn: (room: string) => rooms[room] ?? [], hasSocketsIn: (room: string) => (rooms[room]?.length ?? 0) > 0, all: () => all } as unknown as ConnectionRegistry;
  const gate = { verify: vi.fn((socket: RealtimeSocket & { accepted: boolean }) => Promise.resolve(socket.accepted ? socket.data.session!.principal : undefined)) } as unknown as SessionGate;
  const revalidator = { handleAccess: vi.fn(), whenIdle: () => Promise.resolve() } as unknown as SocketRevalidator;
  const subscriptions = { summaryFor: vi.fn(() => Promise.resolve(options.readable === false ? undefined : summary)), drop: vi.fn() } as unknown as TicketSubscriptionsService;
  const notifications = { unreadCountOf: vi.fn(() => Promise.resolve(3)) } as unknown as NotificationsService;
  const emitted: Array<[string[], string, unknown]> = [];
  const emitter = { emit: (sockets: RealtimeSocket[], event: string, payload: unknown) => emitted.push([sockets.map((socket) => socket.id), event, payload]) } as unknown as RealtimeEmitter;
  const logger = { warn: vi.fn() } as unknown as JsonLogger;
  const router = new SignalRouter({ REALTIME_SIGNAL_QUEUE_MAX: options.queueMax ?? 100 }, source, registry, gate, revalidator, subscriptions, notifications, new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 2 }), emitter, logger);
  router.start();
  return { router, signal: (signal: RealtimeSignal) => onSignal(signal), gap: () => onGap(), gate, subscriptions, notifications, revalidator, emitted };
}

describe('workOf', () => {
  it('splits a notification signal per person and keeps one unit per ticket change or document', () => {
    expect(workOf({ v: 1, k: 'notifications', t: T, u: [U, TICKET] })).toEqual([
      { kind: 'notifications', tenantId: T, userId: U },
      { kind: 'notifications', tenantId: T, userId: TICKET },
    ]);
    expect(workOf({ v: 1, k: 'document', t: T, id: TICKET, d: FILE })).toEqual([{ kind: 'document', tenantId: T, ticketId: TICKET, fileId: FILE }]);
  });
});

describe('SignalRouter', () => {
  afterEach(() => vi.useRealTimers());

  it('a signal without a local audience costs no database work', async () => {
    const { router, signal, gate, notifications, subscriptions, emitted } = setUp({});
    signal({ v: 1, k: 'notifications', t: T, u: [U] });
    signal({ v: 1, k: 'ticket', t: T, id: TICKET, e: 'ticket.assigned' });
    await router.whenIdle();
    expect([gate.verify, notifications.unreadCountOf, subscriptions.summaryFor].map((spy) => (spy as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([0, 0, 0]);
    expect(emitted).toEqual([]);
  });

  it('coalesces the changes of a ticket and reads it once per session, sending only to verified sockets', async () => {
    const tab1 = socketOf(principalOf('s1'));
    const tab2 = socketOf(principalOf('s1'));
    const otherSession = socketOf(principalOf('s2', T, TICKET));
    const waiting = socketOf(principalOf('s3', T, FILE), false);
    const { router, signal, subscriptions, emitted } = setUp({ [RoomNames.ticket(T, TICKET)]: [tab1, tab2, otherSession, waiting] });
    signal({ v: 1, k: 'ticket', t: T, id: TICKET, e: 'ticket.assigned' });
    signal({ v: 1, k: 'ticket', t: T, id: TICKET, e: 'ticket.transitioned' });
    await router.whenIdle();
    expect(subscriptions.summaryFor).toHaveBeenCalledTimes(2);
    expect(emitted).toHaveLength(2);
    expect(emitted).toContainEqual([[tab1.id, tab2.id], 'ticket.changed', { ticketId: TICKET, kinds: ['ticket.assigned', 'ticket.transitioned'], summary }]);
    expect(emitted).toContainEqual([[otherSession.id], 'ticket.changed', expect.objectContaining({ ticketId: TICKET })]);
  });

  it('a ticket the recipient can no longer read is dropped instead of sent', async () => {
    const socket = socketOf(principalOf('s1'));
    const { router, signal, subscriptions, emitted } = setUp({ [RoomNames.ticket(T, TICKET)]: [socket] }, { readable: false });
    signal({ v: 1, k: 'document', t: T, id: TICKET, d: FILE });
    await router.whenIdle();
    expect(subscriptions.drop).toHaveBeenCalledWith(socket, TICKET);
    expect(emitted).toEqual([]);
  });

  it('never acts on a socket of another tenant, whatever the signal says', async () => {
    const foreign = socketOf(principalOf('s1', OTHER_T));
    const { router, signal, subscriptions, emitted } = setUp({ [RoomNames.ticket(T, TICKET)]: [foreign] });
    signal({ v: 1, k: 'ticket', t: T, id: TICKET, e: 'ticket.closed' });
    await router.whenIdle();
    expect(subscriptions.summaryFor).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('sends a person\'s unread counter, read once, to their verified sockets', async () => {
    const tab1 = socketOf(principalOf('s1'));
    const tab2 = socketOf(principalOf('s2'));
    const { router, signal, notifications, emitted } = setUp({ [RoomNames.member(T, U)]: [tab1, tab2] });
    signal({ v: 1, k: 'notifications', t: T, u: [U] });
    signal({ v: 1, k: 'notifications', t: T, u: [U] });
    await router.whenIdle();
    expect(notifications.unreadCountOf).toHaveBeenCalledTimes(1);
    expect(notifications.unreadCountOf).toHaveBeenCalledWith(T, U);
    expect(emitted).toEqual([[[tab1.id, tab2.id], 'notifications.changed', { unreadCount: 3 }]]);
  });

  it('hands access signals to the revalidator', () => {
    const { signal, revalidator } = setUp({});
    signal({ v: 1, k: 'access', s: U });
    expect(revalidator.handleAccess).toHaveBeenCalledWith({ v: 1, k: 'access', s: U });
  });

  it('when the queue overflows it drops the oldest and asks every socket to refetch, once', async () => {
    const socket = socketOf(principalOf('s1'));
    const { router, signal, emitted } = setUp({ [RoomNames.member(T, U)]: [socket], [RoomNames.ticket(T, TICKET)]: [socket] }, { queueMax: 2 });
    for (let index = 0; index < 5; index += 1) signal({ v: 1, k: 'notifications', t: T, u: [U] });
    signal({ v: 1, k: 'ticket', t: T, id: TICKET, e: 'ticket.closed' });
    await router.whenIdle();
    const syncs = emitted.filter(([, event]) => event === 'sync.required');
    expect(syncs).toHaveLength(1);
    expect(syncs[0]![2]).toEqual({ reason: 'SIGNALS_MAY_BE_LOST', delayMs: expect.any(Number) });
    for (let index = 0; index < 5; index += 1) signal({ v: 1, k: 'notifications', t: T, u: [U] });
    await router.whenIdle();
    expect(emitted.filter(([, event]) => event === 'sync.required')).toHaveLength(1);
  });

  it('a listener gap asks every local socket to refetch', () => {
    const socket = socketOf(principalOf('s1'));
    const { gap, emitted } = setUp({ [RoomNames.member(T, U)]: [socket] });
    gap();
    expect(emitted).toEqual([[[socket.id], 'sync.required', { reason: 'SIGNALS_MAY_BE_LOST', delayMs: expect.any(Number) }]]);
  });

  it('after stop it takes no more signals', async () => {
    const socket = socketOf(principalOf('s1'));
    const { router, signal, emitted } = setUp({ [RoomNames.member(T, U)]: [socket] });
    await router.stop();
    signal({ v: 1, k: 'notifications', t: T, u: [U] });
    await router.whenIdle();
    expect(emitted).toEqual([]);
  });
});
