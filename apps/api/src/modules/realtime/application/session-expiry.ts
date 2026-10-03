import { Inject, Injectable } from '@nestjs/common';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { Clock } from '../../../infrastructure/clock.js';
import { RealtimeEmitter } from './realtime-emitter.js';
import { type ReauthReason, type RealtimeSocket, type SocketSession, sessionOf } from './socket-session.js';

/** `setTimeout` cannot wait longer than this; an access token lives 15 minutes anyway. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * When a socket's credentials stop being good: at the token's expiry, or when the database no longer accepts its
 * session. The socket then enters the reauth state (nothing is sent to it) and has `REALTIME_AUTH_GRACE_MS` to send
 * `auth.refresh`; otherwise it is ended.
 */
@Injectable()
export class SessionExpiry {
  constructor(
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_AUTH_GRACE_MS'>,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
  ) {}

  /** The token's expiry is compared with the application clock, like the JWT itself. */
  isExpired(session: SocketSession): boolean {
    return this.clock.now().getTime() >= session.expiresAt.getTime();
  }

  /** (Re)arms the timer that asks for a new token when the current one expires. */
  arm(socket: RealtimeSocket): void {
    const session = sessionOf(socket);
    if (session.ended) return;
    clearTimeout(session.expiryTimer);
    const delay = Math.min(Math.max(0, session.expiresAt.getTime() - this.clock.now().getTime()), MAX_TIMER_MS);
    session.expiryTimer = setTimeout(() => this.requireReauth(socket, 'TOKEN_EXPIRED'), delay);
  }

  requireReauth(socket: RealtimeSocket, reason: ReauthReason): void {
    const session = sessionOf(socket);
    if (session.ended || session.state === 'reauth') return;
    session.state = 'reauth';
    session.reauthReason = reason;
    clearTimeout(session.expiryTimer);
    session.expiryTimer = undefined;
    const graceMs = this.config.REALTIME_AUTH_GRACE_MS;
    this.emitter.emit([socket], 'auth.required', { reason, graceMs });
    session.reauthTimer = setTimeout(() => this.emitter.end(socket, reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'SESSION_ENDED'), graceMs);
  }

  /** A new token was accepted: back to normal, with a timer for the new expiry. */
  resume(socket: RealtimeSocket): void {
    const session = sessionOf(socket);
    if (session.ended) return;
    clearTimeout(session.reauthTimer);
    session.reauthTimer = undefined;
    session.state = 'active';
    session.reauthReason = undefined;
    this.arm(socket);
  }
}
