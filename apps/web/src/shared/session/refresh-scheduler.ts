import type { AccessToken } from './access-token';
import type { TokenStore } from './token-store';

const LEAD_RATIO = 0.2;
const MIN_LEAD_MS = 60_000;
const MAX_JITTER_MS = 15_000;
const WAKE_THRESHOLD_MS = 120_000;
const FIRST_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

/** When to renew: a fifth of the lifetime (at least a minute) before expiry, minus a jitter so tabs do not line up. */
export function refreshDelayMs(token: AccessToken, now: number, random: number): number {
  const lead = Math.max(LEAD_RATIO * (token.expiresAt - token.receivedAt), MIN_LEAD_MS);
  return Math.max(0, token.expiresAt - lead - random * MAX_JITTER_MS - now);
}

export function backoffMs(failures: number): number {
  return Math.min(FIRST_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

export interface RefreshSchedulerDeps {
  readonly store: TokenStore;
  /** Renews in the background; resolves `false` when it should be tried again later (network, server down). */
  readonly renew: (rejected: string) => Promise<boolean>;
  readonly now: () => number;
  readonly random: () => number;
  /** Calls the listener when the page comes back (visible again, back online). */
  readonly onWake: (listener: () => void) => () => void;
}

/**
 * Renews the token before it expires, so the tabs do not all hit a 401 at once. The 401 path of the
 * authorized client stays as the safety net (sleep, throttled background timers, revocation).
 */
export function createRefreshScheduler({ store, renew, now, random, onWake }: RefreshSchedulerDeps): { dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void fire(), delay);
  };

  async function fire() {
    const token = store.get();
    if (token === undefined) return;
    const renewed = await renew(token.value);
    if (renewed || store.get() !== token) return;
    failures += 1;
    schedule(backoffMs(failures));
  }

  const unsubscribeStore = store.subscribe((token) => {
    clearTimeout(timer);
    failures = 0;
    if (token !== undefined) schedule(refreshDelayMs(token, now(), random()));
  });

  const unsubscribeWake = onWake(() => {
    const token = store.get();
    if (token !== undefined && token.expiresAt - now() < WAKE_THRESHOLD_MS) schedule(0);
  });

  return {
    dispose() {
      clearTimeout(timer);
      unsubscribeStore();
      unsubscribeWake();
    },
  };
}
