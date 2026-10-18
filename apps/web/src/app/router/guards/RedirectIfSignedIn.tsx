import { Navigate, Outlet, useSearchParams } from 'react-router';
import { sanitizeReturnTo } from '@/shared/lib/return-to';
import { useSessionState } from '@/shared/session';
import { SessionSplash } from '../../pages/SessionSplash';

/** The login page is only for people without a session: a signed-in person goes where they were heading. */
export function RedirectIfSignedIn() {
  const state = useSessionState();
  const [searchParams] = useSearchParams();
  if (state.status === 'signedIn') return <Navigate replace to={sanitizeReturnTo(searchParams.get('returnTo'), window.location.origin)} />;
  if (state.status === 'bootstrapping' || state.status === 'loadingProfile') return <SessionSplash />;
  return <Outlet />;
}
