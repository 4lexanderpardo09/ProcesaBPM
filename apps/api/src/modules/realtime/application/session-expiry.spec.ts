import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import type { RealtimeEmitter } from './realtime-emitter.js';
import { SessionExpiry } from './session-expiry.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';

const principal: Principal = { userId: 'u', tenantId: 't', sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } };

function setUp(expiresInMs = 60_000) {
  const events: Array<[string, unknown]> = [];
  const emitter = {
    emit: (_sockets: RealtimeSocket[], event: string, payload: unknown) => events.push([event, payload]),
    end: (_socket: RealtimeSocket, reason: string) => events.push(['end', reason]),
  } as unknown as RealtimeEmitter;
  const expiry = new SessionExpiry({ REALTIME_AUTH_GRACE_MS: 1_000 }, new Clock(), emitter);
  const socket = { data: { session: new SocketSession(principal, new Date(Date.now() + expiresInMs), 0, '127.0.0.1') } } as unknown as RealtimeSocket;
  return { expiry, socket, session: socket.data.session!, events };
}

describe('SessionExpiry', () => {
  afterEach(() => vi.useRealTimers());

  it('asks for a new token when the current one expires, then ends the socket after the grace', () => {
    vi.useFakeTimers();
    const { expiry, socket, session, events } = setUp(5_000);
    expiry.arm(socket);
    vi.advanceTimersByTime(5_000);
    expect(session.state).toBe('reauth');
    expect(events).toEqual([['auth.required', { reason: 'TOKEN_EXPIRED', graceMs: 1_000 }]]);
    vi.advanceTimersByTime(1_000);
    expect(events.at(-1)).toEqual(['end', 'TOKEN_EXPIRED']);
  });

  it('resume returns to active with a new expiry timer', () => {
    vi.useFakeTimers();
    const { expiry, socket, session, events } = setUp();
    expiry.requireReauth(socket, 'SESSION_CHANGED');
    expiry.resume(socket);
    vi.advanceTimersByTime(1_000);
    expect(session.state).toBe('active');
    expect(session.expiryTimer).toBeDefined();
    expect(events).toEqual([['auth.required', { reason: 'SESSION_CHANGED', graceMs: 1_000 }]]);
    session.clearTimers();
  });

  it('arms nothing for a socket that already ended (an auth.refresh finishing after the disconnect)', () => {
    const { expiry, socket, session } = setUp();
    session.ended = true;
    expiry.arm(socket);
    expiry.resume(socket);
    expect([session.expiryTimer, session.reauthTimer]).toEqual([undefined, undefined]);
  });
});
