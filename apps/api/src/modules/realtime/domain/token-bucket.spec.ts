import { describe, expect, it } from 'vitest';
import { TokenBucket } from './token-bucket.js';

describe('TokenBucket', () => {
  it('allows a burst up to its capacity, then refuses', () => {
    const bucket = new TokenBucket(3, 1, 0);
    expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills over time without exceeding the capacity', () => {
    const bucket = new TokenBucket(2, 5, 0);
    bucket.take(0);
    bucket.take(0);
    expect(bucket.take(100)).toBe(false);
    expect(bucket.take(200)).toBe(true);
    const later = 60_000;
    expect([bucket.take(later), bucket.take(later), bucket.take(later)]).toEqual([true, true, false]);
  });

  it('ignores a clock that goes backwards', () => {
    const bucket = new TokenBucket(1, 1, 10_000);
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(10_500)).toBe(false);
    expect(bucket.take(11_000)).toBe(true);
  });
});
