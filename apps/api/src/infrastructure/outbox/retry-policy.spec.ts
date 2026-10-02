import { describe, expect, it } from 'vitest';
import { isLastAttempt, MAX_ATTEMPTS, retryDelayMs } from './retry-policy.js';

describe('retryDelayMs', () => {
  it('doubles from 30 seconds and caps at one hour (no jitter at the middle of the range)', () => {
    const middle = () => 0.5;
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, middle))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(9, middle)).toBe(3_600_000);
    expect(retryDelayMs(50, middle)).toBe(3_600_000);
  });

  it('stays within ±20 % of the base', () => {
    expect(retryDelayMs(3, () => 0)).toBe(96_000);
    expect(retryDelayMs(3, () => 1)).toBe(144_000);
  });

  it('the last attempt is terminal', () => {
    expect(isLastAttempt(MAX_ATTEMPTS - 1)).toBe(false);
    expect(isLastAttempt(MAX_ATTEMPTS)).toBe(true);
  });
});
