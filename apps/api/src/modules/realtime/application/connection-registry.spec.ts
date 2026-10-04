import { describe, expect, it } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import { RoomNames } from '../domain/room-names.js';
import { ConnectionRegistry, groupBySession } from './connection-registry.js';
import { type RealtimeServer, type RealtimeSocket, SocketSession } from './socket-session.js';

const principalOf = (userId: string, sessionId: string): Principal => ({
  userId,
  tenantId: 't1',
  sessionId,
  roleId: 'r1',
  roleActive: true,
  roleIsAdmin: false,
  isOwner: false,
  permissionsVersion: 1,
  membership: { departmentId: null, siteId: null, positionId: null }, tenantMode: 'ACTIVE',
});

/** Just enough of a Socket.IO server: the rooms and the connected sockets, cleaned on disconnect like the real one. */
function fakeServer() {
  const rooms = new Map<string, Set<string>>();
  const sockets = new Map<string, RealtimeSocket>();
  let next = 0;
  const connect = (userId: string, sessionId: string, connectedAt: number): RealtimeSocket => {
    const id = `socket-${(next += 1)}`;
    const socket = {
      id,
      data: { session: new SocketSession(principalOf(userId, sessionId), new Date(), connectedAt, '127.0.0.1') },
      join: (names: string | string[]) => {
        for (const name of [names].flat()) rooms.set(name, (rooms.get(name) ?? new Set()).add(id));
      },
      leave: (name: string) => rooms.get(name)?.delete(id),
    } as unknown as RealtimeSocket;
    sockets.set(id, socket);
    rooms.set(id, new Set([id]));
    return socket;
  };
  const disconnect = (socket: RealtimeSocket) => {
    sockets.delete(socket.id);
    for (const [name, members] of rooms) {
      members.delete(socket.id);
      if (members.size === 0) rooms.delete(name);
    }
  };
  const server = { sockets: { adapter: { rooms }, sockets } } as unknown as RealtimeServer;
  return { server, connect, disconnect };
}

describe('ConnectionRegistry', () => {
  it('finds the sockets of a room and only live ones', () => {
    const { server, connect } = fakeServer();
    const registry = new ConnectionRegistry({ REALTIME_MAX_CONNECTIONS_PER_USER: 10 });
    registry.attach(server);
    const a = connect('u1', 's1', 1);
    const b = connect('u2', 's2', 2);
    registry.admit(a);
    registry.admit(b);
    expect(registry.socketsIn(RoomNames.member('t1', 'u1'))).toEqual([a]);
    expect(registry.socketsIn(RoomNames.tenant('t1'))).toEqual([a, b]);
    b.data.session!.ended = true;
    expect(registry.socketsIn(RoomNames.tenant('t1'))).toEqual([a]);
    expect(registry.hasSocketsIn(RoomNames.ticket('t1', 'x'))).toBe(false);
  });

  it('returns the oldest sockets of a person beyond the cap', () => {
    const { server, connect } = fakeServer();
    const registry = new ConnectionRegistry({ REALTIME_MAX_CONNECTIONS_PER_USER: 2 });
    registry.attach(server);
    const first = connect('u1', 's1', 10);
    const second = connect('u1', 's2', 20);
    const third = connect('u1', 's3', 30);
    expect(registry.admit(second)).toEqual([]);
    expect(registry.admit(first)).toEqual([]);
    expect(registry.admit(third)).toEqual([first]);
  });

  it('moves a socket to the room of its new session', () => {
    const { server, connect } = fakeServer();
    const registry = new ConnectionRegistry({ REALTIME_MAX_CONNECTIONS_PER_USER: 2 });
    registry.attach(server);
    const socket = connect('u1', 's1', 1);
    registry.admit(socket);
    registry.moveSession(socket, 's1', 's2');
    expect(registry.socketsIn(RoomNames.session('s1'))).toEqual([]);
    expect(registry.socketsIn(RoomNames.session('s2'))).toEqual([socket]);
  });

  it('reports nothing left after every socket is gone', () => {
    const { server, connect, disconnect } = fakeServer();
    const registry = new ConnectionRegistry({ REALTIME_MAX_CONNECTIONS_PER_USER: 10 });
    registry.attach(server);
    const sockets = [connect('u1', 's1', 1), connect('u1', 's1', 2), connect('u2', 's2', 3)];
    for (const socket of sockets) registry.admit(socket);
    sockets[0]!.data.session!.expiryTimer = setTimeout(() => undefined, 1);
    expect(registry.stats()).toEqual({ sockets: 3, sessions: 2, rooms: 8, timers: 1 });
    sockets[0]!.data.session!.clearTimers();
    for (const socket of sockets) disconnect(socket);
    expect(registry.stats()).toEqual({ sockets: 0, sessions: 0, rooms: 0, timers: 0 });
  });

  it('groups sockets by session', () => {
    const { connect } = fakeServer();
    const a = connect('u1', 's1', 1);
    const b = connect('u1', 's1', 2);
    const c = connect('u1', 's2', 3);
    expect(groupBySession([a, c, b])).toEqual([[a, b], [c]]);
  });
});
