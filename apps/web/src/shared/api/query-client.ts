import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api-error';

const MAX_RETRIES = 2;

/** Only network failures and 5xx get a couple of retries: a 4xx or a session error will not change by asking again. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const transient = error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
  return transient && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
