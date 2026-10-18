import { createContext, type ReactNode, useContext } from 'react';
import type { SessionManager } from '../session-manager';

const SessionContext = createContext<SessionManager | undefined>(undefined);

export function SessionProvider({ manager, children }: { readonly manager: SessionManager; readonly children: ReactNode }) {
  return <SessionContext.Provider value={manager}>{children}</SessionContext.Provider>;
}

export function useSessionManager(): SessionManager {
  const manager = useContext(SessionContext);
  if (manager === undefined) throw new Error('useSessionManager must be used inside <SessionProvider>');
  return manager;
}
