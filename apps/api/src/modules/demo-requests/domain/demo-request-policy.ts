import type { RateLimitPolicy } from '../../../common/auth/rate-limit.js';

const HOUR = 60 * 60_000;

/**
 * Per address of origin and per e-mail. The database adds one request per e-mail a day and a cap for everyone together
 * (submit_demo_request), so a spoofed e-mail cannot fill the sales inbox either.
 */
export const DEMO_REQUEST_RATE_LIMIT = {
  name: 'demo-request',
  perIp: { limit: 5, windowMs: HOUR },
  perIdentifier: { limit: 3, windowMs: HOUR },
} as const satisfies RateLimitPolicy;

/** A bot fills every input, also the one people never see. */
export const isLikelyBot = (honeypot: string | undefined): boolean => honeypot !== undefined && honeypot.trim() !== '';
