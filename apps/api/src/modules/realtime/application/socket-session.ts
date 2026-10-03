import type {
  AuthRequiredPayload,
  NotificationsChangedPayload,
  SessionEndedPayload,
  SyncRequiredPayload,
  TicketAccessLostPayload,
  TicketChangedPayload,
  TicketDocumentGeneratedPayload,
} from '@procesabpm/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { Principal } from '../../../common/auth/principal.js';
import { TokenBucket } from '../domain/token-bucket.js';

/** Client messages: a burst of 20, then 5 per second. `auth.refresh` has its own budget: 6 per minute. */
const MESSAGE_BURST = 20;
const MESSAGES_PER_SECOND = 5;
const REFRESHES_PER_MINUTE = 6;

export interface ServerToClientEvents {
  'notifications.changed': (payload: NotificationsChangedPayload) => void;
  'ticket.changed': (payload: TicketChangedPayload) => void;
  'ticket.document_generated': (payload: TicketDocumentGeneratedPayload) => void;
  'ticket.access_lost': (payload: TicketAccessLostPayload) => void;
  'sync.required': (payload: SyncRequiredPayload) => void;
  'auth.required': (payload: AuthRequiredPayload) => void;
  'session.ended': (payload: SessionEndedPayload) => void;
}

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];

export interface SocketData {
  session?: SocketSession;
}

/** Client events are validated by hand (`ClientMessageRouter`), so they are not typed here. */
export type RealtimeSocket = Socket<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;
export type RealtimeServer = Server<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;

export type ReauthReason = AuthRequiredPayload['reason'];

/**
 * What the server knows about one socket, kept in `socket.data` (gone with the socket). `verifiedAt` and the rate limits
 * use the monotonic process time; `expiresAt` is the token's expiry, compared with the application clock like the JWT.
 */
export class SocketSession {
  verifiedAt: number;
  state: 'active' | 'reauth' = 'active';
  reauthReason: ReauthReason | undefined;
  readonly tickets = new Set<string>();
  readonly messages: TokenBucket;
  readonly refreshes: TokenBucket;
  unknownEvents = 0;
  consecutiveRefusals = 0;
  expiryTimer: NodeJS.Timeout | undefined;
  reauthTimer: NodeJS.Timeout | undefined;
  ended = false;

  constructor(
    public principal: Principal,
    public expiresAt: Date,
    readonly connectedAt: number,
    readonly clientAddress: string,
  ) {
    this.verifiedAt = connectedAt;
    this.messages = new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND, connectedAt);
    this.refreshes = new TokenBucket(REFRESHES_PER_MINUTE, REFRESHES_PER_MINUTE / 60, connectedAt);
  }

  clearTimers(): void {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.reauthTimer);
    this.expiryTimer = undefined;
    this.reauthTimer = undefined;
  }
}

/** Monotonic milliseconds (immune to a test clock and to wall-clock jumps). */
export const monotonicNow = (): number => performance.now();

/**
 * Whether the socket is still in the state the gate verified: active, not ended, same principal. Checked right before
 * sending anything read after an `await` (a logout or refresh may have happened meanwhile).
 */
export function stillVerified(socket: RealtimeSocket, principal: Principal): boolean {
  const session = socket.data.session;
  return session !== undefined && !session.ended && session.state === 'active' && session.principal === principal;
}

/** The session of an authenticated socket. Every socket that reaches the application passed the handshake. */
export function sessionOf(socket: RealtimeSocket): SocketSession {
  const session = socket.data.session;
  if (session === undefined) throw new Error('A socket without a session reached the realtime application');
  return session;
}
