import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { loginPath, paths, type UrlLoginNotice } from '@/shared/lib/paths';
import { type SessionState, type SignOutReason, useCurrentUser, useSessionState } from '@/shared/session';
import { DeletionPendingPage } from '../../pages/DeletionPendingPage';
import { SessionBlockedPage } from '../../pages/SessionBlockedPage';
import { SessionSplash } from '../../pages/SessionSplash';
import { SessionUnavailablePage } from '../../pages/SessionUnavailablePage';

const NOTICE_BY_REASON: Readonly<Record<SignOutReason, UrlLoginNotice | undefined>> = {
  userSignedOut: undefined,
  expired: 'expired',
  mfaRequired: 'mfaRequired',
  signedOutElsewhere: 'signedOutElsewhere',
};

/** The protected part of the app: it renders only with a signed-in session and otherwise shows why not. */
export function RequireSession() {
  const state = useSessionState();
  const location = useLocation();
  const { data: me } = useCurrentUser();
  useHomeOnIdentityChange(state);

  switch (state.status) {
    case 'bootstrapping':
    case 'loadingProfile':
      return <SessionSplash />;
    case 'unavailable':
      return <SessionUnavailablePage />;
    case 'blocked':
      return <SessionBlockedPage block={state.block} />;
    case 'signedOut': {
      const returnTo = state.reason === 'userSignedOut' ? undefined : `${location.pathname}${location.search}${location.hash}`;
      return <Navigate replace to={loginPath(returnTo, state.reason === undefined ? undefined : NOTICE_BY_REASON[state.reason])} />;
    }
    case 'signedIn':
      return me?.tenantMode === 'DELETION_PENDING' ? <DeletionPendingPage /> : <Outlet />;
  }
}

/** A page of one organization means nothing in another: after a switch (in any tab) go back home. */
function useHomeOnIdentityChange(state: SessionState) {
  const navigate = useNavigate();
  const previous = useRef<string | undefined>(undefined);
  const current = state.status === 'signedIn' ? `${state.identity.userId}/${state.identity.tenantId}` : undefined;
  useEffect(() => {
    if (current === undefined) return;
    if (previous.current !== undefined && previous.current !== current) void navigate(paths.home, { replace: true });
    previous.current = current;
  }, [current, navigate]);
}
