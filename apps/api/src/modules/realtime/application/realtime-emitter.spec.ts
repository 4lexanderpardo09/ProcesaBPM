import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import { MAX_PENDING_PACKETS, RealtimeEmitter } from './realtime-emitter.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as JsonLogger;
const principal = { userId: 'u', tenantId: 't', sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null } } satisfies Principal;

function fakeSocket(pending = 0) {
  const emitted: Array<[string, unknown]> = [];
  const socket = {
    id: Math.random().toString(36),
    disconnected: false,
    conn: { writeBuffer: Array.from({ length: pending }) },
    data: { session: new SocketSession(principal, new Date(), 0, '127.0.0.1') },
    emit: (event: string, payload: unknown) => {
      emitted.push([event, payload]);
      return true;
    },
    disconnect: vi.fn(function (this: { disconnected: boolean }) {
      this.disconnected = true;
    }),
  };
  return { socket: socket as unknown as RealtimeSocket, emitted, raw: socket };
}

describe('RealtimeEmitter', () => {
  const emitter = new RealtimeEmitter(logger);

  it('sends the event to every socket it is given', () => {
    const a = fakeSocket();
    const b = fakeSocket();
    emitter.emit([a.socket, b.socket], 'notifications.changed', { unreadCount: 2 });
    expect(a.emitted).toEqual([['notifications.changed', { unreadCount: 2 }]]);
    expect(b.emitted).toEqual([['notifications.changed', { unreadCount: 2 }]]);
  });

  it('closes a socket that is not reading instead of queueing more', () => {
    const slow = fakeSocket(MAX_PENDING_PACKETS + 1);
    emitter.emit([slow.socket], 'notifications.changed', { unreadCount: 1 });
    expect(slow.emitted).toEqual([['session.ended', { reason: 'SLOW_CONSUMER' }]]);
    expect(slow.raw.disconnect).toHaveBeenCalledWith(true);
  });

  it('ends a socket once: tells the reason, closes it and stops its timers', () => {
    const { socket, emitted, raw } = fakeSocket();
    const session = socket.data.session!;
    session.expiryTimer = setTimeout(() => undefined, 60_000);
    emitter.end(socket, 'REPLACED');
    emitter.end(socket, 'SESSION_ENDED');
    emitter.emit([socket], 'notifications.changed', { unreadCount: 1 });
    expect(emitted).toEqual([['session.ended', { reason: 'REPLACED' }]]);
    expect(raw.disconnect).toHaveBeenCalledTimes(1);
    expect(session.expiryTimer).toBeUndefined();
  });

  it('sends no data to a socket that left the active state, but still tells it what to do', () => {
    const waiting = fakeSocket();
    waiting.socket.data.session!.state = 'reauth';
    emitter.emit([waiting.socket], 'ticket.changed', { ticketId: 't', kinds: [], summary: { ticketId: 't', status: 'OPEN', currentStepId: null, currentLoop: 1, assignees: [], lastEventSeq: '1' } });
    emitter.emit([waiting.socket], 'notifications.changed', { unreadCount: 1 });
    emitter.emit([waiting.socket], 'auth.required', { reason: 'SESSION_CHANGED', graceMs: 1000 });
    expect(waiting.emitted).toEqual([['auth.required', { reason: 'SESSION_CHANGED', graceMs: 1000 }]]);
  });
});
