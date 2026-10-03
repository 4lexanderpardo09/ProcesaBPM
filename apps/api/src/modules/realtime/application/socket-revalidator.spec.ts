import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { RoomNames } from '../domain/room-names.js';
import type { ConnectionRegistry } from './connection-registry.js';
import type { SessionExpiry } from './session-expiry.js';
import type { SessionGate } from './session-gate.js';
import type { TicketSubscriptionsService } from './ticket-subscriptions.service.js';
import { SocketRevalidator, socketsTargetedBy } from './socket-revalidator.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';

const T = 't1';
const principal: Principal = { userId: 'u1', tenantId: T, sessionId: 's1', roleId: 'r1', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } };
const socket = (verifiedAt: number) => {
  const session = new SocketSession(principal, new Date(Date.now() + 60_000), 0, '127.0.0.1');
  session.verifiedAt = verifiedAt;
  return { id: Math.random().toString(36), data: { session } } as unknown as RealtimeSocket;
};

function setUp(sockets: RealtimeSocket[], rooms: Record<string, RealtimeSocket[]> = {}, expired = false) {
  const verified: Array<[RealtimeSocket, number]> = [];
  const reauth: RealtimeSocket[] = [];
  const registry = { all: () => sockets, socketsIn: (room: string) => rooms[room] ?? [] } as unknown as ConnectionRegistry;
  const gate = { verify: vi.fn((target: RealtimeSocket, since: number) => (verified.push([target, since]), Promise.resolve(principal))) } as unknown as SessionGate;
  const expiry = { isExpired: () => expired, requireReauth: (target: RealtimeSocket) => reauth.push(target) } as unknown as SessionExpiry;
  const rechecked: RealtimeSocket[] = [];
  const subscriptions = { recheck: (target: RealtimeSocket) => (rechecked.push(target), Promise.resolve()) } as unknown as TicketSubscriptionsService;
  const revalidator = new SocketRevalidator({ REALTIME_REVALIDATE_INTERVAL_MS: 60_000 }, registry, gate, expiry, subscriptions);
  return { revalidator, verified, reauth, rechecked };
}

describe('socketsTargetedBy', () => {
  const s = socket(0);
  const rooms: Record<string, RealtimeSocket[]> = {
    [RoomNames.session('S')]: [s],
    [RoomNames.member(T, 'U')]: [s],
    [RoomNames.role(T, 'R')]: [s],
    [RoomNames.user('U')]: [s],
    [RoomNames.tenant(T)]: [s],
  };
  const registry = { socketsIn: (room: string) => rooms[room]?.map(() => room as unknown as RealtimeSocket) ?? [] };

  it.each([
    [{ v: 1, k: 'access', s: 'S' } as const, RoomNames.session('S')],
    [{ v: 1, k: 'access', t: T, u: 'U' } as const, RoomNames.member(T, 'U')],
    [{ v: 1, k: 'access', t: T, r: 'R' } as const, RoomNames.role(T, 'R')],
    [{ v: 1, k: 'access', u: 'U' } as const, RoomNames.user('U')],
    [{ v: 1, k: 'access', t: T } as const, RoomNames.tenant(T)],
  ])('%j looks in %s', (signal, room) => {
    expect(socketsTargetedBy(signal, registry)).toEqual([room]);
  });

  it('a signal that names nothing finds nothing', () => {
    expect(socketsTargetedBy({ v: 1, k: 'access' }, registry)).toEqual([]);
  });
});

describe('SocketRevalidator', () => {
  afterEach(() => vi.useRealTimers());

  it('re-verifies, after coalescing, the sockets an access signal names, with a check newer than the signal', async () => {
    const a = socket(Number.MAX_SAFE_INTEGER);
    const { revalidator, verified } = setUp([a], { [RoomNames.session('S')]: [a] });
    const before = performance.now();
    revalidator.handleAccess({ v: 1, k: 'access', s: 'S' });
    revalidator.handleAccess({ v: 1, k: 'access', s: 'S' });
    await revalidator.whenIdle();
    expect(verified.map(([target]) => target)).toEqual([a]);
    expect(verified[0]![1]).toBeGreaterThanOrEqual(before);
  });

  it('ignores an access signal that names no local socket', async () => {
    const { revalidator, verified } = setUp([socket(0)]);
    revalidator.handleAccess({ v: 1, k: 'access', s: 'nobody' });
    await revalidator.whenIdle();
    expect(verified).toEqual([]);
  });

  it('sweepNow re-verifies every socket and rechecks the subscriptions of the accepted ones', async () => {
    const sockets = [socket(0), socket(0)];
    const { revalidator, verified, rechecked } = setUp(sockets);
    await revalidator.sweepNow();
    expect(verified.map(([target]) => target)).toEqual(sockets);
    expect(rechecked).toEqual(sockets);
  });

  it('the periodic sweep re-verifies only the sockets due, spread over the interval, and asks expired tokens for a new one', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const due = Array.from({ length: 24 }, () => socket(-Infinity));
    const fresh = socket(Number.MAX_SAFE_INTEGER);
    const { revalidator, verified, reauth } = setUp([...due, fresh], {}, true);
    revalidator.start();
    vi.advanceTimersByTime(5_000);
    revalidator.stop();
    await revalidator.whenIdle();
    expect(verified).toHaveLength(Math.ceil(25 / 12));
    expect(verified.every(([target]) => target !== fresh)).toBe(true);
    expect(reauth).toHaveLength(25);
  });
});
