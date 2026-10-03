import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Principal } from '../../../common/auth/principal.js';
import { AccessTokenAuthenticator } from '../../auth/application/access-token-authenticator.js';
import { sameAuthorization } from '../domain/authorization-snapshot.js';
import { isTransient, verificationFailureOf } from '../domain/close-reasons.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import { RealtimeEmitter } from './realtime-emitter.js';
import { SessionExpiry } from './session-expiry.js';
import { monotonicNow, type RealtimeSocket, type SocketSession, sessionOf } from './socket-session.js';

/** A verification younger than this is trusted without asking the database again (D15). */
export const VERIFICATION_MEMO_MS = 1_000;
export const VERIFICATION_TIMEOUT_MS = 5_000;

/** Neither ended nor waiting for a new token. */
const isActive = (session: SocketSession): boolean => !session.ended && session.state === 'active';

interface InFlight {
  readonly startedAt: number;
  readonly result: Promise<Principal>;
}

/**
 * The single gate before anything is sent to a socket and before any subscription: is the session that opened it still
 * accepted, with the same authorization? It runs the same database checks as an HTTP request (`reverify`). Sockets of
 * one session share a check that is in flight. Outcomes: the principal; `undefined` (send nothing now); and, as side
 * effects, the reauth state (session refused) or the end of the socket (MFA, tenant, changed permissions).
 */
@Injectable()
export class SessionGate {
  private readonly inFlight = new Map<string, InFlight>();

  constructor(
    @Inject(AccessTokenAuthenticator) private readonly authenticator: AccessTokenAuthenticator,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
    @Inject(SessionExpiry) private readonly expiry: SessionExpiry,
    @Inject(RealtimeEmitter) private readonly emitter: RealtimeEmitter,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * `freshSince` (monotonic ms): a verification that started before it does not count. By default the memo window;
   * after an access signal, the moment the signal arrived (so a check that predates the change is never reused).
   */
  async verify(socket: RealtimeSocket, freshSince = monotonicNow() - VERIFICATION_MEMO_MS): Promise<Principal | undefined> {
    const session = sessionOf(socket);
    if (!isActive(session)) return undefined;
    if (this.expiry.isExpired(session)) {
      this.expiry.requireReauth(socket, 'TOKEN_EXPIRED');
      return undefined;
    }
    if (session.verifiedAt >= freshSince) return session.principal;

    const checked = session.principal;
    const check = this.check(checked, freshSince);
    let fresh: Principal;
    try {
      fresh = await check.result;
    } catch (error) {
      // Same guard as for an answer: a failure about a state the socket already left (refreshed, ended) is not acted on.
      if (isActive(session) && session.principal === checked) this.fail(socket, error);
      return undefined;
    }
    // Meanwhile the socket may have ended, entered reauth or refreshed its token: this answer is about the old state.
    if (!isActive(session) || session.principal !== checked) return undefined;
    if (!sameAuthorization(checked, fresh)) {
      this.emitter.end(socket, 'PERMISSIONS_CHANGED');
      return undefined;
    }
    session.verifiedAt = Math.max(session.verifiedAt, check.startedAt);
    return session.principal;
  }

  private check(principal: Principal, freshSince: number): InFlight {
    const key = `${principal.tenantId}:${principal.userId}:${principal.sessionId}`;
    const existing = this.inFlight.get(key);
    if (existing !== undefined && existing.startedAt >= freshSince) return existing;
    const identity = { userId: principal.userId, tenantId: principal.tenantId, sessionId: principal.sessionId };
    const entry: InFlight = { startedAt: monotonicNow(), result: this.limiter.run(() => this.authenticator.reverify(identity), VERIFICATION_TIMEOUT_MS) };
    this.inFlight.set(key, entry);
    const forget = () => {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    };
    entry.result.then(forget, forget);
    return entry;
  }

  private fail(socket: RealtimeSocket, error: unknown): void {
    const failure = verificationFailureOf(error);
    if (failure.kind === 'reauth') this.expiry.requireReauth(socket, 'SESSION_CHANGED');
    else if (failure.kind === 'end') this.emitter.end(socket, failure.reason);
    else if (isTransient(error)) this.logger.warn('realtime.verification_unavailable', { event: 'realtime.verification_unavailable', socketId: socket.id });
    else this.logger.error('realtime.verification_failed', { event: 'realtime.verification_failed', socketId: socket.id, errorName: error instanceof Error ? error.name : typeof error });
  }
}
