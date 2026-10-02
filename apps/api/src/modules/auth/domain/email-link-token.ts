import { createHmac } from 'node:crypto';

/**
 * The one-time token of an e-mailed link, derived from the outbox event that sends it. Deriving (instead of drawing a
 * random one) is what makes a retry safe: after a crash the worker computes the same token, finds its stored hash and
 * sends the same link, so there is never a second token and the first is never lost. The key only the worker has
 * keeps the event id (which is not secret) from being enough to forge it.
 */
export function deriveEmailLinkToken(key: string, eventId: string): string {
  return createHmac('sha256', key).update(`user-token:v1:${eventId}`).digest('base64url');
}
