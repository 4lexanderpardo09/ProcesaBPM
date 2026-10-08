import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/auth/rate-limit.js';
import { InMemoryRateLimiter, RATE_LIMITER } from './rate-limiter.js';

/**
 * The rate limiter and its guard on their own. Any module can use them without importing the whole auth graph:
 * `FilesModule` is shared with the worker, which must never pull AuthModule in. The limiter itself is a singleton
 * here, so every route that shares a policy name counts against the same windows. The clock is global.
 */
@Module({
  providers: [{ provide: RATE_LIMITER, useClass: InMemoryRateLimiter }, RateLimitGuard],
  exports: [RATE_LIMITER, RateLimitGuard],
})
export class RateLimitModule {}
