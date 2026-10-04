import type { RateLimitRule } from '../../../infrastructure/security/rate-limiter.js';

const HOUR = 60 * 60 * 1000;

/** How often support may look accounts up and reset second factors (docs/arquitectura.md, MFA reset by support). */
export const PLATFORM_USER_SUPPORT_LIMITS = {
  lookupsPerAdmin: { limit: 30, windowMs: HOUR },
  resetsPerAdmin: { limit: 10, windowMs: HOUR },
  resetsPerUser: { limit: 3, windowMs: 24 * HOUR },
} as const satisfies Record<string, RateLimitRule>;
