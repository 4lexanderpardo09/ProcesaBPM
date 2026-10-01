import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../infrastructure/clock.js';
import { InMemoryRateLimiter } from '../../infrastructure/security/rate-limiter.js';
import { RateLimit, RateLimitGuard } from './rate-limit.js';

const policy = { name: 'login', perIp: { limit: 3, windowMs: 60_000 }, perIdentifier: { limit: 2, windowMs: 60_000 } };

class Routes {
  @RateLimit(policy)
  limited(): void {}
  free(): void {}
}

function setup() {
  const clock: Clock = { now: () => new Date(0) };
  const guard = new RateLimitGuard(new Reflector(), new InMemoryRateLimiter(clock));
  const call = (handler: keyof Routes, body: unknown, ip = '10.0.0.1') =>
    guard.canActivate({
      getHandler: () => Routes.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ ip, body }) }),
    } as unknown as ExecutionContext);
  return { call };
}

describe('RateLimitGuard', () => {
  it('ignores routes without a policy', async () => {
    const { call } = setup();
    for (let i = 0; i < 10; i += 1) await expect(call('free', {})).resolves.toBe(true);
  });

  it('limits per e-mail, normalized', async () => {
    const { call } = setup();
    await call('limited', { email: 'Jane@Example.com' }, '10.0.0.1');
    await call('limited', { email: 'jane@example.com ' }, '10.0.0.2');
    await expect(call('limited', { email: 'JANE@example.com' }, '10.0.0.3')).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('limits per token when there is no e-mail', async () => {
    const { call } = setup();
    await call('limited', { token: 't1' }, '10.0.0.1');
    await call('limited', { token: 't1' }, '10.0.0.2');
    await expect(call('limited', { token: 't1' }, '10.0.0.3')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(call('limited', { token: 't2' }, '10.0.0.4')).resolves.toBe(true);
  });

  it('limits per IP whatever the body', async () => {
    const { call } = setup();
    await call('limited', { email: 'a@example.com' });
    await call('limited', { email: 'b@example.com' });
    await call('limited', 'not an object');
    await expect(call('limited', { email: 'c@example.com' })).rejects.toBeInstanceOf(RateLimitedError);
  });
});
