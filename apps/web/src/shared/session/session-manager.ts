import { ERROR_CODES, type AccessTokenResponse } from '@procesabpm/shared';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, type HttpClient, NetworkError } from '@/shared/api';
import { type AccessToken, sameIdentity, type SessionIdentity } from './access-token';
import { createAuthorizedHttpClient } from './authorized-http-client';
import type { RefreshCoordinator } from './refresh-coordinator';
import { createRefreshScheduler } from './refresh-scheduler';
import { currentUserQueryOptions } from './session-api';
import type { SessionChannel } from './session-channel';
import { refreshFailureOf, sessionEffectOf } from './session-error-policy';
import { type RefreshFailure, RefreshFailedError, type SessionBlock, SessionChangedError, SessionEndedError, type SignOutReason } from './session-errors';
import { identityOf, initialSessionState, type SessionEvent, sessionReducer, type SessionState } from './session-state';
import type { TokenStore } from './token-store';

const MAX_MAINTENANCE_RETRY_SECONDS = 300;
const DEFAULT_MAINTENANCE_RETRY_SECONDS = 60;

export interface SessionManager {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  /** Recovers the session from the refresh cookie. Idempotent, so StrictMode and re-renders are harmless. */
  start(): void;
  retry(): void;
  /** Opens a session with the selection token (select-tenant); the state follows from the new token. */
  establish(open: () => Promise<AccessTokenResponse>): Promise<void>;
  signOut(): Promise<void>;
  /** Authorized HTTP client: bearer token, renewal on 401 and session-level error handling. */
  readonly client: HttpClient;
  /** Plain transport for the anonymous sign-in calls, which carry a challenge or selection token instead. */
  readonly publicClient: HttpClient;
  dispose(): void;
}

export interface SessionManagerDeps {
  readonly transport: HttpClient;
  readonly store: TokenStore;
  readonly coordinator: RefreshCoordinator;
  readonly channel: SessionChannel;
  readonly queryClient: QueryClient;
  readonly now: () => number;
  readonly random: () => number;
  readonly onWake: (listener: () => void) => () => void;
}

/** Wires the token store, the cross-tab coordinator, the state machine and the query cache. */
export function createSessionManager({ transport, store, coordinator, channel, queryClient, now, random, onWake }: SessionManagerDeps): SessionManager {
  let state: SessionState = initialSessionState;
  let started = false;
  let checkingDeletion = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let scheduler: { dispose(): void } | undefined;
  const listeners = new Set<() => void>();

  const dispatch = (event: SessionEvent) => {
    const next = sessionReducer(state, event);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };

  /** Server data of one identity must never be shown to another: cancel what is in flight, then drop everything. */
  const dropServerData = () => {
    void queryClient.cancelQueries();
    queryClient.clear();
  };

  const forgetLocally = () => {
    store.clear();
    dropServerData();
  };

  const client = createAuthorizedHttpClient(transport, { current: () => store.get(), renew: renewForRequest }, { report: handleRequestError });

  function failureOf(error: unknown): RefreshFailure {
    return error instanceof RefreshFailedError ? error.failure : refreshFailureOf(error);
  }

  function renewForRequest(rejected: string | undefined): Promise<AccessToken> {
    return coordinator.renew(rejected).catch((error: unknown) => {
      const failure = failureOf(error);
      if (failure.kind === 'network') throw new NetworkError(error);
      if (failure.kind === 'unavailable') throw error;
      handleRefreshFailure(failure);
      throw new SessionEndedError();
    });
  }

  function renewInBackground(rejected: string): Promise<boolean> {
    return coordinator.renew(rejected).then(
      () => true,
      (error: unknown) => {
        const failure = failureOf(error);
        if (failure.kind === 'network' || failure.kind === 'unavailable') return false;
        handleRefreshFailure(failure);
        return true;
      },
    );
  }

  function bootstrap() {
    coordinator.renew().then(adopt, (error: unknown) => handleRefreshFailure(failureOf(error)));
  }

  /** A token for an identity this tab is not showing yet: drop the old data and load the profile. */
  function adopt(token: AccessToken) {
    if (sameIdentity(identityOf(state), token.identity) && state.status !== 'blocked') return;
    dropServerData();
    dispatch({ type: 'TOKEN_ACQUIRED', identity: token.identity });
    loadProfile(token.identity);
  }

  function handleRefreshFailure(failure: RefreshFailure) {
    const hadSession = identityOf(state) !== undefined;
    dispatch({ type: 'REFRESH_FAILED', failure });
    if (failure.kind === 'unauthenticated') {
      forgetLocally();
      if (hadSession) channel.post({ type: 'signed-out', reason: 'expired' });
    } else if (failure.kind === 'mfaRequired') {
      void endSession('mfaRequired', true);
    } else if (failure.kind === 'blocked') {
      block(failure.block);
    }
  }

  function block(sessionBlock: SessionBlock) {
    forgetLocally();
    dispatch({ type: 'BLOCKED', block: sessionBlock });
    if (sessionBlock.kind !== 'maintenance') return;
    const seconds = Math.min(sessionBlock.retryAfterSeconds ?? DEFAULT_MAINTENANCE_RETRY_SECONDS, MAX_MAINTENANCE_RETRY_SECONDS);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retry, seconds * 1000);
  }

  function handleRequestError(error: ApiError) {
    const effect = sessionEffectOf(error);
    if (effect === undefined || checkingDeletion) return;
    if (effect.kind === 'ended') void endSession(effect.reason, effect.reason === 'mfaRequired');
    else if (effect.kind === 'blocked') block(effect.block);
    else void checkDeletionPending();
  }

  /** An owner or administrator may stay in a pending-deletion organization (export only); anyone else is blocked. */
  async function checkDeletionPending() {
    checkingDeletion = true;
    try {
      const me = await queryClient.fetchQuery({ ...currentUserQueryOptions(client), staleTime: 0 });
      if (me.tenantMode === 'DELETION_PENDING') return;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === ERROR_CODES.tenantPendingDeletion)) return;
    } finally {
      checkingDeletion = false;
    }
    block({ kind: 'tenantPendingDeletion' });
  }

  async function endSession(reason: SignOutReason, revoke: boolean) {
    await coordinator.endSession(revoke);
    dropServerData();
    dispatch({ type: 'SESSION_ENDED', reason });
    channel.post({ type: 'signed-out', reason });
  }

  function loadProfile(identity: SessionIdentity) {
    queryClient
      .fetchQuery(currentUserQueryOptions(client))
      .then(() => dispatch({ type: 'PROFILE_LOADED', identity }))
      .catch((error: unknown) => {
        const handledElsewhere =
          error instanceof SessionEndedError || error instanceof SessionChangedError || (error instanceof ApiError && sessionEffectOf(error) !== undefined);
        if (!handledElsewhere) dispatch({ type: 'PROFILE_FAILED', identity });
      });
  }

  function retry() {
    clearTimeout(retryTimer);
    dispatch({ type: 'RETRY' });
    bootstrap();
  }

  const unsubscribeStore = store.subscribe((token) => {
    if (token !== undefined) adopt(token);
  });

  const unsubscribeChannel = channel.subscribe((message) => {
    if (message.type !== 'signed-out') return;
    forgetLocally();
    dispatch({ type: 'SESSION_ENDED', reason: message.reason === 'expired' ? 'expired' : 'signedOutElsewhere' });
  });

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      scheduler = createRefreshScheduler({ store, renew: renewInBackground, now, random, onWake });
      bootstrap();
    },
    retry,
    async establish(open) {
      dropServerData();
      await coordinator.establish(open);
    },
    signOut: () => endSession('userSignedOut', true),
    client,
    publicClient: transport,
    dispose() {
      clearTimeout(retryTimer);
      scheduler?.dispose();
      unsubscribeStore();
      unsubscribeChannel();
    },
  };
}
