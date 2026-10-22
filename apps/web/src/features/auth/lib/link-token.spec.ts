import { describe, expect, it } from 'vitest';
import { tokenFromHash } from './link-token';

describe('tokenFromHash', () => {
  it('reads the token of the fragment', () => {
    expect(tokenFromHash('#token=abc123')).toBe('abc123');
  });

  it('gives nothing when the link has no token', () => {
    expect(tokenFromHash('')).toBeUndefined();
    expect(tokenFromHash('#token=')).toBeUndefined();
  });
});
