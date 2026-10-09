import { describe, expect, it } from 'vitest';
import { evaluateReservation, quotaLimits, quotaWarningLevel, storageState } from './quota-policy.js';

const GB = 1024n ** 3n;
const trial = { baseBytes: GB, perUserBytes: 0n, gracePercent: 5, extraBytes: 0n, activeUsers: 7 };
const basic = { baseBytes: 10n * GB, perUserBytes: GB, gracePercent: 5, extraBytes: 0n, activeUsers: 4 };
const none = { usedBytes: 0n, reservedBytes: 0n };

describe('quotaLimits', () => {
  it('trial: 1 GB whatever the users', () => expect(quotaLimits(trial).limitBytes).toBe(GB));
  it('basic: 10 GB plus 1 GB per active user', () => expect(quotaLimits(basic).limitBytes).toBe(14n * GB));
  it('adds the extra storage bought on top', () => expect(quotaLimits({ ...basic, extraBytes: 5n * GB }).limitBytes).toBe(19n * GB));
  it('the hard limit is the limit plus the grace percentage, rounded down', () => {
    expect(quotaLimits(trial).hardLimitBytes).toBe(GB + (GB * 5n) / 100n);
    expect(quotaLimits({ ...trial, baseBytes: 10n, gracePercent: 5 }).hardLimitBytes).toBe(10n);
  });
});

describe('evaluateReservation', () => {
  const limits = quotaLimits(trial);

  it('allows what fits under the limit without a warning', () => {
    expect(evaluateReservation(limits, none, GB)).toEqual({ allowed: true, overLimit: false });
  });
  it('allows up to exactly the hard limit, flagging that the plan limit was passed', () => {
    expect(evaluateReservation(limits, none, limits.hardLimitBytes)).toEqual({ allowed: true, overLimit: true });
  });
  it('refuses one byte beyond the hard limit', () => {
    expect(evaluateReservation(limits, none, limits.hardLimitBytes + 1n)).toEqual({ allowed: false });
  });
  it('counts what is stored and what is reserved', () => {
    const usage = { usedBytes: GB / 2n, reservedBytes: GB / 2n };
    expect(evaluateReservation(limits, usage, 1n)).toEqual({ allowed: true, overLimit: true });
    expect(evaluateReservation(limits, { ...usage, reservedBytes: limits.hardLimitBytes }, 1n)).toEqual({ allowed: false });
  });
});

describe('storageState', () => {
  const limits = quotaLimits(trial);
  it('is OK under the limit, OVER_LIMIT in the grace margin and BLOCKED at the hard limit', () => {
    expect(storageState(limits, none)).toBe('OK');
    expect(storageState(limits, { usedBytes: GB, reservedBytes: 0n })).toBe('OK');
    expect(storageState(limits, { usedBytes: GB + 1n, reservedBytes: 0n })).toBe('OVER_LIMIT');
    expect(storageState(limits, { usedBytes: limits.hardLimitBytes, reservedBytes: 0n })).toBe('BLOCKED');
  });
});

describe('quotaWarningLevel', () => {
  const limits = { limitBytes: 1000n, hardLimitBytes: 1100n };

  it('is the highest threshold reached, of the plan limit (not of the grace margin)', () => {
    expect(quotaWarningLevel(limits, 0n)).toBe(0);
    expect(quotaWarningLevel(limits, 799n)).toBe(0);
    expect(quotaWarningLevel(limits, 800n)).toBe(80);
    expect(quotaWarningLevel(limits, 949n)).toBe(80);
    expect(quotaWarningLevel(limits, 950n)).toBe(95);
    expect(quotaWarningLevel(limits, 1050n)).toBe(95);
  });

  it('a plan without storage warns at the first byte, and never for an empty organization', () => {
    expect(quotaWarningLevel({ limitBytes: 0n, hardLimitBytes: 0n }, 0n)).toBe(0);
    expect(quotaWarningLevel({ limitBytes: 0n, hardLimitBytes: 0n }, 1n)).toBe(95);
  });
});
