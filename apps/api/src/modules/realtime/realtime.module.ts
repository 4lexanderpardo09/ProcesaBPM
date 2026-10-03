import { Module } from '@nestjs/common';
import { RealtimeListenerModule } from '../../infrastructure/realtime/realtime-listener.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConnectionRegistry } from './application/connection-registry.js';
import { DbWorkLimiter } from './application/db-work-limiter.js';
import { RealtimeEmitter } from './application/realtime-emitter.js';
import { SessionExpiry } from './application/session-expiry.js';
import { SessionGate } from './application/session-gate.js';
import { SessionRefresher } from './application/session-refresher.js';
import { SocketRevalidator } from './application/socket-revalidator.js';
import { ClientMessageRouter } from './gateway/client-message-router.js';
import { RealtimeGateway } from './gateway/realtime.gateway.js';
import { SocketHandshake } from './gateway/socket-handshake.js';

/**
 * The API's real time (`/realtime`, Socket.IO): authenticated sockets kept current with the database. Imported by the
 * API only when `REALTIME_ENABLED` (see `app.module.ts`); the worker has `RealtimeWorkerModule` instead.
 */
@Module({
  imports: [AuthModule, RealtimeListenerModule],
  providers: [
    RealtimeGateway,
    SocketHandshake,
    ClientMessageRouter,
    ConnectionRegistry,
    DbWorkLimiter,
    RealtimeEmitter,
    SessionExpiry,
    SessionGate,
    SessionRefresher,
    SocketRevalidator,
  ],
})
export class RealtimeModule {}
