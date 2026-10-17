import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeJwt } from '@/test/jwt';
import { type AccessToken, toAccessToken } from './access-token';
import { backoffMs, createRefreshScheduler, refreshDelayMs } from './refresh-scheduler';
import { createTokenStore } from './token-store';

const MINUTE = 60_000;
const tokenAt = (receivedAt: number, lifetimeMs = 15 * MINUTE): AccessToken =>
  toAccessToken({ accessToken: makeJwt(), tokenType: 'Bearer', expiresIn: lifetimeMs / 1000 }, receivedAt);

describe('refreshDelayMs', () => {
  it('renews a 15-minute token three minutes before it expires, minus the jitter', () => {
    expect(refreshDelayMs(tokenAt(0), 0, 0)).toBe(12 * MINUTE);
    expect(refreshDelayMs(tokenAt(0), 0, 1)).toBe(12 * MINUTE - 15_000);
  });

  it('keeps at least one minute of margin for short tokens', () => {
    expect(refreshDelayMs(tokenAt(0, 2 * MINUTE), 0, 0)).toBe(MINUTE);
  });

  it('renews at once when the time already passed', () => {
    expect(refreshDelayMs(tokenAt(0), 14 * MINUTE, 0)).toBe(0);
  });
});

describe('backoffMs', () => {
  it('doubles from 2 s up to one minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });
});

describe('createRefreshScheduler', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  function setUp(renewResult = true) {
    const store = createTokenStore();
    const renew = vi.fn((_rejected: string) => Promise.resolve(renewResult));
    let wake: () => void = () => undefined;
    const scheduler = createRefreshScheduler({
      store,
      renew,
      now: () => Date.now(),
      random: () => 0,
      onWake: (listener) => ((wake = listener), () => undefined),
    });
    return { store, renew, scheduler, wake: () => wake() };
  }

  it('renews the current token when its time comes', async () => {
    const { store, renew } = setUp();
    const token = tokenAt(0);
    store.set(token);

    await vi.advanceTimersByTimeAsync(12 * MINUTE - 1);
    expect(renew).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledWith(token.value);
  });

  it('starts over with each new token', async () => {
    const { store, renew } = setUp();
    store.set(tokenAt(0));
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    store.set(tokenAt(Date.now()));
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(renew).not.toHaveBeenCalled();
  });

  it('backs off while renewing keeps failing', async () => {
    const { store, renew } = setUp(false);
    store.set(tokenAt(0));
    await vi.advanceTimersByTimeAsync(12 * MINUTE);
    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(renew).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(renew).toHaveBeenCalledTimes(3);
  });

  it('renews on wake when the token is close to expiry', async () => {
    const { store, renew, wake } = setUp();
    store.set(tokenAt(0));
    vi.setSystemTime(14 * MINUTE);
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).toHaveBeenCalledOnce();
  });

  it('does nothing on wake while the token has time left', async () => {
    const { store, renew, wake } = setUp();
    store.set(tokenAt(0));
    wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(renew).not.toHaveBeenCalled();
  });

  it('stops when the token is cleared or the scheduler is disposed', async () => {
    const { store, renew, scheduler } = setUp();
    store.set(tokenAt(0));
    store.clear();
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    store.set(tokenAt(Date.now()));
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(renew).not.toHaveBeenCalled();
  });
});
