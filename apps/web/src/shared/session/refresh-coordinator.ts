import type { AccessTokenResponse } from '@procesabpm/shared';
import { type HttpClient, NetworkError } from '@/shared/api';
import { type AccessToken, accessTokenOf, sameIdentity, toAccessToken } from './access-token';
import type { ExclusiveLock } from './exclusive-lock';
import { logoutSession, refreshSession } from './session-api';
import type { SessionChannel, SessionMessage } from './session-channel';
import { refreshFailureOf } from './session-error-policy';
import { RefreshFailedError, type SignOutReason } from './session-errors';
import type { TokenStore } from './token-store';

export interface RefreshCoordinator {
  /** A usable token: the current one, a peer's, or a renewed one. `rejected` is a token the API just refused. */
  renew(rejected?: string): Promise<AccessToken>;
  /** Opens a new session (select-tenant) under the same lock as the refresh, so two cookie writes never race. */
  establish(open: () => Promise<AccessTokenResponse>): Promise<AccessToken>;
  /** Forgets the token, ends the session on the server when `revoke` (best effort) and tells the other tabs, all under the lock. */
  endSession(revoke: boolean, reason: SignOutReason): Promise<void>;
  dispose(): void;
}

export interface RefreshCoordinatorDeps {
  readonly transport: HttpClient;
  readonly store: TokenStore;
  readonly lock: ExclusiveLock;
  readonly channel: SessionChannel;
  readonly now: () => number;
  readonly createRequestId: () => string;
  /** How long a starting tab waits for another tab to hand over its token. */
  readonly peerTimeoutMs?: number;
  /** A token closer than this to its expiry is renewed instead of reused. */
  readonly minRemainingMs?: number;
  /** A tab only shares a token with at least this much life left. */
  readonly minShareableMs?: number;
}

/**
 * Every request that touches the refresh cookie (refresh, select-tenant, logout) runs under one lock
 * shared by all tabs, so each one sends the cookie the previous one wrote: a rotated refresh token is
 * never presented twice (the API revokes every session when that happens after its 10 s grace).
 * Inside the lock a tab first checks whether another tab already renewed, so tabs do not rotate in turn.
 */
export function createRefreshCoordinator({
  transport,
  store,
  lock,
  channel,
  now,
  createRequestId,
  peerTimeoutMs = 200,
  minRemainingMs = 30_000,
  minShareableMs = 60_000,
}: RefreshCoordinatorDeps): RefreshCoordinator {
  let flight: Promise<AccessToken> | undefined;
  const pendingPeerRequests = new Map<string, (token: AccessToken) => void>();

  const usable = (rejected: string | undefined, minimumMs = minRemainingMs) => {
    const token = store.get();
    return token !== undefined && token.value !== rejected && token.expiresAt - now() > minimumMs ? token : undefined;
  };

  const broadcast = (token: AccessToken) =>
    channel.post({ type: 'token', token: token.value, receivedAt: token.receivedAt, expiresAt: token.expiresAt });

  const unsubscribe = channel.subscribe((message: SessionMessage) => {
    if (message.type === 'token') adoptBroadcast(message);
    else if (message.type === 'token-response') handOver(message);
    else if (message.type === 'token-request') answerPeer(message.requestId);
  });

  function handOver(message: { requestId: string; token: string; receivedAt: number; expiresAt: number }) {
    const token = tokenFrom(message);
    if (token !== undefined) pendingPeerRequests.get(message.requestId)?.(token);
  }

  /** A token from another tab, unless it is already expired or older than the one this tab holds for the same identity. */
  function adoptBroadcast(message: { token: string; receivedAt: number; expiresAt: number }) {
    const token = tokenFrom(message);
    if (token === undefined || token.expiresAt <= now()) return;
    const current = store.get();
    if (current !== undefined && sameIdentity(current.identity, token.identity) && current.receivedAt > token.receivedAt) return;
    store.set(token);
  }

  function answerPeer(requestId: string) {
    const token = usable(undefined, minShareableMs);
    if (token !== undefined) channel.post({ type: 'token-response', requestId, token: token.value, receivedAt: token.receivedAt, expiresAt: token.expiresAt });
  }

  function askPeers(): Promise<AccessToken | undefined> {
    const requestId = createRequestId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(undefined), peerTimeoutMs);
      function finish(token: AccessToken | undefined) {
        clearTimeout(timer);
        pendingPeerRequests.delete(requestId);
        resolve(token);
      }
      pendingPeerRequests.set(requestId, finish);
      channel.post({ type: 'token-request', requestId });
    });
  }

  async function refreshWithOneRetry(): Promise<AccessTokenResponse> {
    try {
      return await refreshSession(transport);
    } catch (error) {
      // Still inside the lock and well within the API's 10 s grace: a lost answer is safe to ask again.
      if (error instanceof NetworkError) return refreshSession(transport);
      throw error;
    }
  }

  async function renewLocked(rejected: string | undefined): Promise<AccessToken> {
    const renewedMeanwhile = usable(rejected);
    if (renewedMeanwhile !== undefined) return renewedMeanwhile;
    if (store.get() === undefined) {
      const fromPeer = await askPeers();
      if (fromPeer !== undefined) {
        store.set(fromPeer);
        return fromPeer;
      }
    }
    try {
      const token = toAccessToken(await refreshWithOneRetry(), now());
      store.set(token);
      broadcast(token);
      return token;
    } catch (error) {
      throw new RefreshFailedError(refreshFailureOf(error));
    }
  }

  return {
    renew(rejected) {
      const ready = usable(rejected);
      if (ready !== undefined) return Promise.resolve(ready);
      flight ??= lock.run(() => renewLocked(rejected)).finally(() => {
        flight = undefined;
      });
      return flight;
    },
    establish(open) {
      return lock.run(async () => {
        const token = toAccessToken(await open(), now());
        store.set(token);
        broadcast(token);
        return token;
      });
    },
    endSession(revoke, reason) {
      return lock.run(async () => {
        if (revoke) await logoutSession(transport).catch(() => undefined);
        store.clear();
        channel.post({ type: 'signed-out', reason });
      });
    },
    dispose() {
      unsubscribe();
      pendingPeerRequests.clear();
    },
  };
}

function tokenFrom(message: { token: string; receivedAt: number; expiresAt: number }): AccessToken | undefined {
  return accessTokenOf(message.token, message.receivedAt, message.expiresAt);
}
