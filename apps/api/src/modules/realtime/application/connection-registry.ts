import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { connectionRooms, RoomNames } from '../domain/room-names.js';
import { type RealtimeServer, type RealtimeSocket, sessionOf } from './socket-session.js';

export interface RegistryStats {
  readonly sockets: number;
  readonly sessions: number;
  /** Named rooms (Socket.IO's own room per socket id is not counted). */
  readonly rooms: number;
  readonly timers: number;
}

/**
 * The local sockets of this instance, found through the rooms they joined. Socket.IO drops a socket from its rooms when
 * it disconnects, so nothing here needs cleaning. Rooms only find candidates; whoever emits authorizes each one.
 */
@Injectable()
export class ConnectionRegistry {
  private server: RealtimeServer | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_MAX_CONNECTIONS_PER_USER'>) {}

  attach(server: RealtimeServer): void {
    this.server = server;
  }

  /**
   * Joins the connection rooms and returns the sockets of the same person on this instance that exceed the cap, oldest
   * first (the caller ends them as `REPLACED`).
   */
  admit(socket: RealtimeSocket): RealtimeSocket[] {
    const { principal } = sessionOf(socket);
    void socket.join(connectionRooms(principal));
    const mine = this.socketsIn(RoomNames.user(principal.userId)).sort((a, b) => sessionOf(a).connectedAt - sessionOf(b).connectedAt);
    return mine.slice(0, Math.max(0, mine.length - this.config.REALTIME_MAX_CONNECTIONS_PER_USER));
  }

  /** A refresh may rotate the session id: the socket moves to the new session's room. */
  moveSession(socket: RealtimeSocket, previousSessionId: string, sessionId: string): void {
    if (previousSessionId === sessionId) return;
    void socket.leave(RoomNames.session(previousSessionId));
    void socket.join(RoomNames.session(sessionId));
  }

  socketsIn(room: string): RealtimeSocket[] {
    const ids = this.server?.sockets.adapter.rooms.get(room);
    if (ids === undefined) return [];
    return [...ids].flatMap((id) => this.liveSocket(id));
  }

  hasSocketsIn(room: string): boolean {
    return (this.server?.sockets.adapter.rooms.get(room)?.size ?? 0) > 0;
  }

  all(): RealtimeSocket[] {
    return [...(this.server?.sockets.sockets.values() ?? [])].filter((socket) => socket.data.session !== undefined);
  }

  stats(): RegistryStats {
    const sockets = this.all();
    const rooms = this.server === undefined ? 0 : [...this.server.sockets.adapter.rooms.keys()].filter((room) => !this.server!.sockets.sockets.has(room)).length;
    return {
      sockets: sockets.length,
      sessions: new Set(sockets.map((socket) => sessionOf(socket).principal.sessionId)).size,
      rooms,
      timers: sockets.filter((socket) => sessionOf(socket).expiryTimer !== undefined || sessionOf(socket).reauthTimer !== undefined).length,
    };
  }

  private liveSocket(id: string): RealtimeSocket[] {
    const socket = this.server?.sockets.sockets.get(id);
    return socket !== undefined && socket.data.session !== undefined && !socket.data.session.ended ? [socket] : [];
  }
}

/** Groups sockets by the session that authenticated them: one re-verification serves all of them. */
export function groupBySession(sockets: readonly RealtimeSocket[]): RealtimeSocket[][] {
  const groups = new Map<string, RealtimeSocket[]>();
  for (const socket of sockets) {
    const key = sessionOf(socket).principal.sessionId;
    groups.set(key, [...(groups.get(key) ?? []), socket]);
  }
  return [...groups.values()];
}
