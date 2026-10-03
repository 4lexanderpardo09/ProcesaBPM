import { type BeforeApplicationShutdown, Inject } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { REALTIME_PATH } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { stopAdmitting } from '../../../infrastructure/realtime/realtime-io-adapter.js';
import { ConnectionRegistry } from '../application/connection-registry.js';
import { RealtimeEmitter } from '../application/realtime-emitter.js';
import { SessionExpiry } from '../application/session-expiry.js';
import { SignalRouter } from '../application/signal-router.js';
import { SocketRevalidator } from '../application/socket-revalidator.js';
import { type RealtimeServer, type RealtimeSocket, sessionOf } from '../application/socket-session.js';
import { ClientMessageRouter } from './client-message-router.js';
import { SocketHandshake } from './socket-handshake.js';

const SHUTDOWN_BATCH = 500;
const SHUTDOWN_BATCH_PAUSE_MS = 100;

/** The server must come from `RealtimeIoAdapter` (installed by `configureHttpApp`): never Nest's permissive default. */
function assertHardened(server: RealtimeServer): void {
  const transports = server.engine.opts.transports;
  if (server.path() !== REALTIME_PATH || transports?.length !== 1 || transports[0] !== 'websocket') {
    throw new Error('The realtime gateway needs RealtimeIoAdapter: call configureHttpApp before app.init()');
  }
}

/**
 * Lifecycle only: install the handshake and the signal router, admit a connection (rooms, per-person cap, message router, expiry timer),
 * forget a disconnected one, and close everything on shutdown. No `@SubscribeMessage` handlers (see ClientMessageRouter).
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit<RealtimeServer>, OnGatewayConnection<RealtimeSocket>, OnGatewayDisconnect<RealtimeSocket>, BeforeApplicationShutdown {
  private server: RealtimeServer | undefined;

  constructor(
    @Inject(SocketHandshake) private readonly handshake: SocketHandshake,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(ClientMessageRouter) private readonly messages: ClientMessageRouter,
    @Inject(SessionExpiry) private readonly expiry: SessionExpiry,
    @Inject(SocketRevalidator) private readonly revalidator: SocketRevalidator,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(SignalRouter) private readonly signals: SignalRouter,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  afterInit(server: RealtimeServer): void {
    assertHardened(server);
    this.server = server;
    this.registry.attach(server);
    server.use(this.handshake.middleware);
    this.signals.start();
    this.revalidator.start();
  }

  handleConnection(socket: RealtimeSocket): void {
    for (const replaced of this.registry.admit(socket)) this.emitter.end(replaced, 'REPLACED');
    this.messages.wire(socket);
    this.expiry.arm(socket);
    const { principal } = sessionOf(socket);
    this.logger.info('realtime.connected', { event: 'realtime.connected', tenantId: principal.tenantId, userId: principal.userId, socketId: socket.id });
  }

  handleDisconnect(socket: RealtimeSocket): void {
    socket.data.session?.clearTimers();
  }

  /** Before the database goes away: refuse new sockets, then end the open ones in small batches (clients reconnect elsewhere). */
  async beforeApplicationShutdown(): Promise<void> {
    this.revalidator.stop();
    await this.signals.stop();
    if (this.server === undefined) return;
    stopAdmitting(this.server);
    const sockets = this.registry.all();
    for (let start = 0; start < sockets.length; start += SHUTDOWN_BATCH) {
      if (start > 0) await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_BATCH_PAUSE_MS));
      for (const socket of sockets.slice(start, start + SHUTDOWN_BATCH)) this.emitter.end(socket, 'SERVER_SHUTDOWN');
    }
  }
}
