import { useEffect, useState } from 'react';
import { ApiError } from '@/shared/api';

/** True while a rate-limited answer asks to wait (`Retry-After`), so the form cannot be sent again meanwhile. */
export function useRetryCountdown(error: unknown): boolean {
  const seconds = error instanceof ApiError && error.status === 429 ? error.retryAfterSeconds : undefined;
  const [waitingFor, setWaitingFor] = useState<unknown>(undefined);

  useEffect(() => {
    if (seconds === undefined || seconds <= 0) return undefined;
    setWaitingFor(error);
    const timer = setTimeout(() => setWaitingFor(undefined), seconds * 1000);
    return () => clearTimeout(timer);
  }, [error, seconds]);

  return waitingFor !== undefined && waitingFor === error;
}
