import { Inject, Injectable } from '@nestjs/common';
import { type ConnectErrorCode, RateLimitedError, UnauthenticatedError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { clientAddressOf, markAuthenticated } from '../../../infrastructure/realtime/realtime-io-adapter.js';
import { normalizeClientAddress } from '../../../infrastructure/security/client-address.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';
import { AccessTokenAuthenticator } from '../../auth/application/access-token-authenticator.js';
import { connectErrorCodeOf } from '../domain/close-reasons.js';
import { DbWorkLimiter } from '../application/db-work-limiter.js';
import { AUTHENTICATION_TIMEOUT_MS } from '../application/session-refresher.js';
import { monotonicNow, type RealtimeSocket, SocketSession } from '../application/socket-session.js';

const MAX_TOKEN_LENGTH = 4096;
/** Generous per address: a whole office behind one NAT reconnects at once after a deploy. Per person it stays tight. */
export const HANDSHAKES_PER_ADDRESS: RateLimitRule = { limit: 600, windowMs: 60_000 };
export const HANDSHAKES_PER_USER: RateLimitRule = { limit: 30, windowMs: 60_000 };
const TOKEN_QUERY_KEYS = ['token', 'access_token', 'accessToken', 'authorization'];

export interface ConnectError extends Error {
  readonly data: { readonly code: ConnectErrorCode; readonly retryAfterSeconds?: number };
}

type Next = (error?: Error) => void;

/** A token anywhere but the auth payload (URL, header) is refused: URLs end up in logs, history and `Referer`. */
function carriesTokenOutsideAuth(socket: RealtimeSocket): boolean {
  const query = socket.handshake.query;
  return TOKEN_QUERY_KEYS.some((key) => query[key] !== undefined) || socket.handshake.headers.authorization !== undefined;
}

function tokenOf(auth: unknown): string {
  const token = typeof auth === 'object' && auth !== null ? (auth as { token?: unknown }).token : undefined;
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw new UnauthenticatedError();
  return token;
}

function connectError(error: unknown): ConnectError {
  const code = connectErrorCodeOf(error);
  const retryAfterSeconds = error instanceof RateLimitedError ? error.retryAfterSeconds : undefined;
  return Object.assign(new Error(code), { data: retryAfterSeconds === undefined ? { code } : { code, retryAfterSeconds } });
}

/**
 * The Socket.IO middleware that authenticates a socket when its CONNECT packet arrives, before any handler: the token
 * from the auth payload only, rate limits per address and per person, and the same checks as the HTTP guard
 * (`AccessTokenAuthenticator`), bounded in time. The refusal carries a code and nothing else; the token is never logged.
 */
@Injectable()
export class SocketHandshake {
  constructor(
    @Inject(AccessTokenAuthenticator) private readonly authenticator: AccessTokenAuthenticator,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  readonly middleware = (socket: RealtimeSocket, next: Next): void => {
    this.authenticate(socket).then(
      () => next(),
      (error: unknown) => next(this.refuse(socket, error)),
    );
  };

  private async authenticate(socket: RealtimeSocket): Promise<void> {
    const address = clientAddressOf(socket.request);
    if (carriesTokenOutsideAuth(socket)) {
      this.logger.warn('realtime.token_in_url_rejected', { event: 'realtime.token_in_url_rejected', ip: address });
      throw new UnauthenticatedError();
    }
    const token = tokenOf(socket.handshake.auth);
    // Per /64 for IPv6 (normalizeClientAddress): one host cannot rotate its address to reset the budget.
    await this.limit(`realtime.handshake:ip:${normalizeClientAddress(address)}`, HANDSHAKES_PER_ADDRESS);
    const access = await this.limiter.run(() => this.authenticator.authenticate(token), AUTHENTICATION_TIMEOUT_MS, 'interactive');
    await this.limit(`realtime.handshake:user:${access.principal.userId}`, HANDSHAKES_PER_USER);
    socket.data.session = new SocketSession(access.principal, access.expiresAt, monotonicNow(), address);
    markAuthenticated(socket.request);
  }

  private async limit(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.rateLimiter.hit(key, rule);
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
  }

  private refuse(socket: RealtimeSocket, error: unknown): ConnectError {
    const refusal = connectError(error);
    const ip = clientAddressOf(socket.request);
    if (refusal.data.code === 'UNAUTHENTICATED' && !(error instanceof UnauthenticatedError)) {
      this.logger.error('realtime.handshake_failed', { event: 'realtime.handshake_failed', ip, errorName: error instanceof Error ? error.name : typeof error });
    }
    this.logger.info('realtime.rejected', { event: 'realtime.rejected', code: refusal.data.code, ip });
    return refusal;
  }
}
