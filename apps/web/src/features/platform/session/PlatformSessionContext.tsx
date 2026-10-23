import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from 'react';
import { useSessionManager } from '@/shared/session';
import { createPlatformSession, type PlatformSession, type PlatformSessionState } from './platform-session';

const PlatformSessionContext = createContext<PlatformSession | undefined>(undefined);

/** One console session per page, over the same plain transport the sign-in uses. */
export function PlatformSessionProvider({ children }: { readonly children: ReactNode }) {
  const transport = useSessionManager().publicClient;
  const [session] = useState(() => createPlatformSession(transport));
  return <PlatformSessionContext.Provider value={session}>{children}</PlatformSessionContext.Provider>;
}

export function usePlatformSession(): PlatformSession {
  const session = useContext(PlatformSessionContext);
  if (session === undefined) throw new Error('usePlatformSession must be used inside <PlatformSessionProvider>');
  return session;
}

/** The open console session, re-rendering when it opens or ends. */
export function usePlatformSessionState(): PlatformSessionState | null {
  const session = usePlatformSession();
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

/** The HTTP client of the console (the platform token). */
export function usePlatformClient() {
  return usePlatformSession().client;
}
