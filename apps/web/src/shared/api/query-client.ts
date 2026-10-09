import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

const MAX_RETRIES = 2;

/** A 4xx will not change by asking again; network failures and 5xx get a couple of retries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
