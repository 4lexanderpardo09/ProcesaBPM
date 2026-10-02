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
  let authorization: string | undefined;
  const call = (handler: keyof Routes, body: unknown, ip = '10.0.0.1') =>
    guard.canActivate({
      getHandler: () => Routes.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ ip, body, header: (name: string) => (name === 'authorization' ? authorization : undefined) }) }),
    } as unknown as ExecutionContext);
  return { call, withBearer: (value: string | undefined) => (authorization = value === undefined ? undefined : `Bearer ${value}`) };
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

  it('limits per bearer token on routes that carry no e-mail or token in the body', async () => {
    const { call, withBearer } = setup();
    withBearer('selection-1');
    await call('limited', undefined, '10.0.0.1');
    await call('limited', {}, '10.0.0.2');
    await expect(call('limited', undefined, '10.0.0.3')).rejects.toBeInstanceOf(RateLimitedError);
    withBearer('selection-2');
    await expect(call('limited', undefined, '10.0.0.4')).resolves.toBe(true);
  });

  it('a client over its IP limit does not spend the budget of the e-mail it targets', async () => {
    const { call } = setup();
    for (let i = 0; i < 3; i += 1) await call('limited', { email: `x${i}@example.com` }, '10.0.0.9');
    await expect(call('limited', { email: 'victim@example.com' }, '10.0.0.9')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(call('limited', { email: 'victim@example.com' }, '10.0.0.9')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(call('limited', { email: 'victim@example.com' }, '10.0.1.1')).resolves.toBe(true);
    await expect(call('limited', { email: 'victim@example.com' }, '10.0.1.2')).resolves.toBe(true);
  });

  it('limits per IP whatever the body', async () => {
    const { call } = setup();
    await call('limited', { email: 'a@example.com' });
    await call('limited', { email: 'b@example.com' });
    await call('limited', 'not an object');
    await expect(call('limited', { email: 'c@example.com' })).rejects.toBeInstanceOf(RateLimitedError);
  });
});
