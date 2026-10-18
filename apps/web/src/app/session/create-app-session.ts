import { API_PREFIX } from '@procesabpm/shared';
import type { QueryClient } from '@tanstack/react-query';
import { createHttpClient } from '@/shared/api';
import {
  createBroadcastSessionChannel,
  createInProcessLock,
  createRefreshCoordinator,
  createSessionManager,
  createTokenStore,
  createWebLock,
  type ExclusiveLock,
  type SessionManager,
} from '@/shared/session';

const CHANNEL_NAME = 'procesabpm.session.v1';
const LOCK_NAME = 'procesabpm.session.refresh';

/** Composition root of the session: one per page load, created outside React so StrictMode cannot start two. */
export function createAppSession(queryClient: QueryClient): SessionManager {
  const transport = createHttpClient({ baseUrl: API_PREFIX });
  const store = createTokenStore();
  const channel = createBroadcastSessionChannel(CHANNEL_NAME);
  const coordinator = createRefreshCoordinator({ transport, store, lock: crossTabLock(), channel, now: Date.now, createRequestId: () => crypto.randomUUID() });
  return createSessionManager({ transport, store, coordinator, channel, queryClient, now: Date.now, random: Math.random, onWake });
}

/** Web Locks keep the tabs from racing on the refresh cookie; without them (very old browsers) only this tab is protected. */
function crossTabLock(): ExclusiveLock {
  return 'locks' in navigator ? createWebLock(LOCK_NAME, navigator.locks) : createInProcessLock();
}

function onWake(listener: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', listener);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', listener);
  };
}
