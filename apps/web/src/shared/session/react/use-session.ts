import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { HttpClient } from '@/shared/api';
import { type PermissionCheck, grants } from '../permissions';
import { currentUserQueryOptions, myPermissionsQueryOptions } from '../session-api';
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

/**
 * What the person may do, to show only the screens and buttons they can use. While it loads, nothing is granted (an
 * action appears a moment later rather than appearing and failing); the API still decides every request.
 */
export function usePermissions() {
  const manager = useSessionManager();
  const { status } = useSessionState();
  const query = useQuery({ ...myPermissionsQueryOptions(manager.client), enabled: status === 'signedIn' });
  const permissions = query.data?.permissions ?? [];
  return {
    loaded: query.data !== undefined,
    can: (action: string, subject: string) => grants(permissions, [action, subject]),
    canAny: (checks: readonly PermissionCheck[]) => checks.some((check) => grants(permissions, check)),
  };
}
