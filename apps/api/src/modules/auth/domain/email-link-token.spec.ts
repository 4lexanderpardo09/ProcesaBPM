import { describe, expect, it } from 'vitest';
import { deriveEmailLinkToken } from './email-link-token.js';

const KEY = 'k'.repeat(32);

describe('deriveEmailLinkToken', () => {
  it('is deterministic per event and key, URL-safe and 256 bits long', () => {
    const token = deriveEmailLinkToken(KEY, 'event-1');
    expect(token).toBe(deriveEmailLinkToken(KEY, 'event-1'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('differs for another event or another key', () => {
    expect(deriveEmailLinkToken(KEY, 'event-1')).not.toBe(deriveEmailLinkToken(KEY, 'event-2'));
    expect(deriveEmailLinkToken(KEY, 'event-1')).not.toBe(deriveEmailLinkToken('j'.repeat(32), 'event-1'));
  });
});
