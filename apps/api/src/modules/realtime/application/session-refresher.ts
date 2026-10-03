import { Inject, Injectable } from '@nestjs/common';
import type { AuthRefreshAck } from '@procesabpm/shared';
import { AccessTokenAuthenticator, type AuthenticatedAccess } from '../../auth/application/access-token-authenticator.js';
import { sameAuthorization } from '../domain/authorization-snapshot.js';
import { refreshFailureOf, type RefreshFailure } from '../domain/close-reasons.js';
import type { MessageOutcome } from './message-outcome.js';
import { ConnectionRegistry } from './connection-registry.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import { SessionExpiry } from './session-expiry.js';
import { monotonicNow, type RealtimeSocket, sessionOf } from './socket-session.js';

export const AUTHENTICATION_TIMEOUT_MS = 5_000;

const refused = (failure: RefreshFailure): MessageOutcome<AuthRefreshAck> => ({ ack: { ok: false, code: failure.code }, endWith: failure.end });

/**
 * `auth.refresh`: the client hands over the access token it just got from `POST /auth/refresh`. It is checked exactly
 * like a handshake; it must belong to the same person in the same tenant (the session id may change: a refresh rotates
 * it) and grant the same authorization. Otherwise the socket ends.
 */
@Injectable()
export class SessionRefresher {
  constructor(
    @Inject(AccessTokenAuthenticator) private readonly authenticator: AccessTokenAuthenticator,
    @Inject(DbWorkLimiter) private readonly limiter: DbWorkLimiter,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(SessionExpiry) private readonly expiry: SessionExpiry,
  ) {}

  async refresh(socket: RealtimeSocket, token: string): Promise<MessageOutcome<AuthRefreshAck>> {
    const startedAt = monotonicNow();
    let access: AuthenticatedAccess;
    try {
      access = await this.limiter.run(() => this.authenticator.authenticate(token), AUTHENTICATION_TIMEOUT_MS, 'interactive');
    } catch (error) {
      return refused(refreshFailureOf(error));
    }
    const session = sessionOf(socket);
    const current = session.principal;
    if (session.ended) return refused({ code: 'UNAUTHENTICATED', end: undefined });
    if (access.principal.userId !== current.userId || access.principal.tenantId !== current.tenantId) return refused({ code: 'UNAUTHENTICATED', end: 'SESSION_ENDED' });
    if (!sameAuthorization(current, access.principal)) return refused({ code: 'PERMISSIONS_CHANGED', end: 'PERMISSIONS_CHANGED' });

    session.principal = access.principal;
    session.expiresAt = access.expiresAt;
    session.verifiedAt = startedAt;
    this.registry.moveSession(socket, current.sessionId, access.principal.sessionId);
    this.expiry.resume(socket);
    return { ack: { ok: true, expiresAt: access.expiresAt.toISOString() }, endWith: undefined };
  }
}
