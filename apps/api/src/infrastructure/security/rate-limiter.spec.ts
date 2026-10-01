import { describe, expect, it } from 'vitest';
import type { Clock } from '../clock.js';
import { InMemoryRateLimiter } from './rate-limiter.js';

function setup() {
  let now = 0;
  const clock: Clock = { now: () => new Date(now) };
  return { limiter: new InMemoryRateLimiter(clock), advance: (ms: number) => (now += ms) };
}

const rule = { limit: 3, windowMs: 60_000 };

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit within a window', async () => {
    const { limiter } = setup();
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await limiter.hit('ip:1', rule));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSeconds).toBe(60);
  });

  it('counts keys separately', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) await limiter.hit('ip:1', rule);
    expect((await limiter.hit('ip:2', rule)).allowed).toBe(true);
    expect((await limiter.hit('ip:1', rule)).allowed).toBe(false);
  });

  it('opens a new window when the previous one ends', async () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i += 1) await limiter.hit('ip:1', rule);
    advance(30_000);
    expect(await limiter.hit('ip:1', rule)).toEqual({ allowed: false, retryAfterSeconds: 30 });
    advance(30_000);
    expect(await limiter.hit('ip:1', rule)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('forgets expired windows', async () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 999; i += 1) await limiter.hit(`ip:${i}`, rule);
    advance(61_000);
    await limiter.hit('ip:new', rule);
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBe(1);
  });
});
