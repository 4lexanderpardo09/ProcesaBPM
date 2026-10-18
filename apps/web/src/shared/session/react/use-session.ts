import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { HttpClient } from '@/shared/api';
import { currentUserQueryOptions } from '../session-api';
import type { SessionState } from '../session-state';
import { useSessionManager } from './SessionContext';

export function useSessionState(): SessionState {
  const manager = useSessionManager();
  return useSyncExternalStore(manager.subscribe, manager.getState);
}

/** The HTTP client every feature uses: it carries the session token. */
export function useApiClient(): HttpClient {
  return useSessionManager().client;
}

export function useCurrentUser() {
  const manager = useSessionManager();
  const { status } = useSessionState();
  return useQuery({ ...currentUserQueryOptions(manager.client), enabled: status === 'signedIn' || status === 'loadingProfile' });
}
