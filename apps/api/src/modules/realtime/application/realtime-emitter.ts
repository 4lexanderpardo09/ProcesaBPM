import { Inject, Injectable } from '@nestjs/common';
import type { SessionEndReason } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { monotonicNow, type RealtimeSocket, type ServerEventName, type ServerEventPayload } from './socket-session.js';

/** Packets waiting to be written to one socket before it is considered too slow to keep. */
export const MAX_PENDING_PACKETS = 100;

/** engine.io keeps unsent packets in `writeBuffer` (internal; pinned version, see the emitter spec). */
interface EngineConnection {
  readonly writeBuffer?: readonly unknown[];
}

export function pendingPackets(socket: RealtimeSocket): number {
  return (socket.conn as unknown as EngineConnection).writeBuffer?.length ?? 0;
}

/**
 * THE only place that sends anything to a socket or closes one (`architecture.spec.ts` enforces it). Nothing is
 * broadcast: callers pass the sockets they authorized. A socket that does not read what it is sent is closed.
 */
@Injectable()
export class RealtimeEmitter {
  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  emit<E extends ServerEventName>(sockets: Iterable<RealtimeSocket>, event: E, payload: ServerEventPayload<E>): void {
    for (const socket of sockets) {
      if (socket.data.session?.ended === true || socket.disconnected) continue;
      if (pendingPackets(socket) > MAX_PENDING_PACKETS) {
        this.logger.warn('realtime.slow_consumer', { event: 'realtime.slow_consumer', socketId: socket.id });
        this.end(socket, 'SLOW_CONSUMER');
        continue;
      }
      this.send(socket, event, payload);
    }
  }

  /** Tells the client why, then closes the socket (a server-side close disables the client's automatic reconnection). */
  end(socket: RealtimeSocket, reason: SessionEndReason): void {
    const session = socket.data.session;
    if (session?.ended === true) return;
    if (session !== undefined) {
      session.ended = true;
      session.clearTimers();
    }
    this.logger.info('realtime.ended', {
      event: 'realtime.ended',
      reason,
      socketId: socket.id,
      tenantId: session?.principal.tenantId,
      userId: session?.principal.userId,
      durationMs: session === undefined ? undefined : Math.round(monotonicNow() - session.connectedAt),
    });
    this.send(socket, 'session.ended', { reason });
    socket.disconnect(true);
  }

  private send<E extends ServerEventName>(socket: RealtimeSocket, event: E, payload: ServerEventPayload<E>): void {
    (socket.emit as (name: E, data: ServerEventPayload<E>) => boolean)(event, payload);
  }
}
