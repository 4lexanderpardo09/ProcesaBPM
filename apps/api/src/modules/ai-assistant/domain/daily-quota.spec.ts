import { AiDailyLimitReachedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { assertWithinDailyLimit, quotaDay, remainingJobs } from './daily-quota.js';

const limits = { jobsPerDay: 10, tokensPerDay: 1_000_000 };

describe('daily quota', () => {
  it('counts the day from midnight to midnight in the organization time zone', () => {
    // 2026-10-27 03:30 UTC is still the 26th in Bogotá (UTC-5).
    const day = quotaDay(new Date('2026-10-27T03:30:00Z'), 'America/Bogota');
    expect(day).toEqual({ since: new Date('2026-10-26T05:00:00Z'), resetsAt: new Date('2026-10-27T05:00:00Z') });
    expect(quotaDay(new Date('2026-10-27T03:30:00Z'), 'UTC').since).toEqual(new Date('2026-10-27T00:00:00Z'));
  });

  it('runs out when the requests or the tokens of the day are used up', () => {
    expect(remainingJobs(limits, { jobs: 3, tokens: 50_000 })).toBe(7);
    expect(remainingJobs(limits, { jobs: 10, tokens: 0 })).toBe(0);
    expect(remainingJobs(limits, { jobs: 1, tokens: 1_000_000 })).toBe(0);
  });

  it('refuses a request over the limit and says when it resets', () => {
    const day = quotaDay(new Date('2026-10-27T15:00:00Z'), 'America/Bogota');
    expect(() => assertWithinDailyLimit(limits, { jobs: 9, tokens: 0 }, day)).not.toThrow();
    const error = (() => {
      try {
        assertWithinDailyLimit(limits, { jobs: 10, tokens: 0 }, day);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(AiDailyLimitReachedError);
    expect((error as AiDailyLimitReachedError).details).toEqual({ resetsAt: '2026-10-28T05:00:00.000Z' });
  });
});
