export const MAX_ATTEMPTS = 10;
export const LEASE = '5 minutes';
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;
const JITTER = 0.2;

/**
 * Exponential backoff with jitter: about 30 s, 1 min, 2 min… capped at one hour. `attempt` counts claims, so the
 * first failure is attempt 1. The last allowed attempt is terminal (the database marks it FAILED), which with these
 * numbers means the event is given up on about three and a half hours after it was queued.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}

export const isLastAttempt = (attempt: number): boolean => attempt >= MAX_ATTEMPTS;
