import { accessTokenResponseSchema, type AccessTokenResponse, meResponseSchema } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

const PROFILE_STALE_MS = 5 * 60_000;

/** Renews the session with the httpOnly cookie. Plain transport: no bearer token. */
export function refreshSession(transport: HttpClient): Promise<AccessTokenResponse> {
  return transport.request('/auth/refresh', { method: 'POST', schema: accessTokenResponseSchema });
}

/** Revokes the session on the server and clears the cookie. */
export function logoutSession(transport: HttpClient): Promise<void> {
  return transport.request('/auth/logout', { method: 'POST' });
}

export const currentUserQueryKey = ['session', 'me'] as const;

export function currentUserQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => client.request('/auth/me', { schema: meResponseSchema, signal }),
    staleTime: PROFILE_STALE_MS,
  });
}
