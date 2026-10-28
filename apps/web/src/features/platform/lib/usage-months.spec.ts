import { describe, expect, it } from 'vitest';
import { recentUsageMonths, USAGE_MONTHS, usageMonthLabel, usageMonthOf } from './usage-months';

describe('usage months', () => {
  it('turns a month into its first and last day', () => {
    expect(usageMonthOf('2026-10')).toEqual({ value: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(usageMonthOf('2028-02')).toEqual({ value: '2028-02', from: '2028-02-01', to: '2028-02-29' });
  });

  it('offers the current UTC month and the twelve before it, across the year', () => {
    const months = recentUsageMonths(new Date('2026-01-31T23:00:00Z'));
    expect(months).toHaveLength(USAGE_MONTHS);
    expect(months[0]?.value).toBe('2026-01');
    expect(months[1]?.value).toBe('2025-12');
    expect(months.at(-1)?.value).toBe('2025-01');
  });

  it('names the month in Spanish', () => {
    expect(usageMonthLabel(usageMonthOf('2026-10'))).toBe('octubre de 2026');
  });
});
