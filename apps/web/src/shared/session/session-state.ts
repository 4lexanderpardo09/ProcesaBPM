import { type SessionIdentity, sameIdentity } from './access-token';
import type { RefreshFailure, SessionBlock, SignOutReason } from './session-errors';

export type SessionState =
  | { readonly status: 'bootstrapping' }
  | { readonly status: 'signedOut'; readonly reason: SignOutReason | undefined }
  | { readonly status: 'loadingProfile'; readonly identity: SessionIdentity }
  | { readonly status: 'signedIn'; readonly identity: SessionIdentity }
  | { readonly status: 'blocked'; readonly block: SessionBlock }
  | { readonly status: 'unavailable' };

export type SessionEvent =
  | { readonly type: 'TOKEN_ACQUIRED'; readonly identity: SessionIdentity }
  | { readonly type: 'PROFILE_LOADED'; readonly identity: SessionIdentity }
  | { readonly type: 'PROFILE_FAILED'; readonly identity: SessionIdentity }
  | { readonly type: 'REFRESH_FAILED'; readonly failure: RefreshFailure }
  | { readonly type: 'SESSION_ENDED'; readonly reason: SignOutReason }
  | { readonly type: 'BLOCKED'; readonly block: SessionBlock }
  | { readonly type: 'RETRY' };

export const initialSessionState: SessionState = { status: 'bootstrapping' };

export function identityOf(state: SessionState): SessionIdentity | undefined {
  return state.status === 'signedIn' || state.status === 'loadingProfile' ? state.identity : undefined;
}

/** Pure transitions of the session; the session manager runs the side effects. Events that do not apply leave the state as is. */
export function sessionReducer(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'TOKEN_ACQUIRED':
      return sameIdentity(identityOf(state), event.identity) ? state : { status: 'loadingProfile', identity: event.identity };
    case 'PROFILE_LOADED':
      return isLoading(state, event.identity) ? { status: 'signedIn', identity: event.identity } : state;
    case 'PROFILE_FAILED':
      return isLoading(state, event.identity) ? { status: 'unavailable' } : state;
    case 'REFRESH_FAILED':
      return afterRefreshFailure(state, event.failure);
    case 'SESSION_ENDED':
      return state.status === 'signedOut' ? state : { status: 'signedOut', reason: event.reason };
    case 'BLOCKED':
      return { status: 'blocked', block: event.block };
    case 'RETRY':
      return state.status === 'unavailable' || state.status === 'blocked' ? initialSessionState : state;
  }
}

function isLoading(state: SessionState, identity: SessionIdentity): boolean {
  return state.status === 'loadingProfile' && sameIdentity(state.identity, identity);
}

function afterRefreshFailure(state: SessionState, failure: RefreshFailure): SessionState {
  switch (failure.kind) {
    case 'unauthenticated':
      if (state.status === 'signedOut') return state;
      return { status: 'signedOut', reason: state.status === 'bootstrapping' ? undefined : 'expired' };
    case 'mfaRequired':
      return { status: 'signedOut', reason: 'mfaRequired' };
    case 'blocked':
      return { status: 'blocked', block: failure.block };
    case 'network':
    case 'unavailable':
      // A signed-in tab keeps working with what it has and retries; only a tab that never got a session shows the error.
      return identityOf(state) === undefined ? { status: 'unavailable' } : state;
  }
}
