import { describe, expect, it } from 'vitest';
import type { BusinessCalendar } from '../business-time/types.js';
import { afterCurrentCutoff, cutoffDeadline, cutoffPeriodEnd, type CutoffTerm } from './cutoff-deadline.js';

/** Monday to Friday, 08:00 to 17:00 in Bogotá (UTC-5): a day closes at 22:00 UTC. */
const calendar: BusinessCalendar = { timeZone: 'America/Bogota', slots: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '17:00' })), holidays: [] };
const cutoff = (day: number, graceBusinessDays = 0): CutoffTerm => ({ day, graceBusinessDays });
const deadline = (base: unknown, businessDays: number, cutoffs: readonly CutoffTerm[] = []) => cutoffDeadline({ base, businessDays, cutoffs, calendar, timeZone: calendar.timeZone })?.toISOString() ?? null;

describe('cutoffPeriodEnd', () => {
  it('is the first cutoff of the month on or after the day, or the first of the next month', () => {
    expect(cutoffPeriodEnd([cutoff(20), cutoff(5)], '2026-10-01')?.date).toBe('2026-10-05');
    expect(cutoffPeriodEnd([cutoff(20), cutoff(5)], '2026-10-05')?.date).toBe('2026-10-05');
    expect(cutoffPeriodEnd([cutoff(20), cutoff(5)], '2026-10-25')?.date).toBe('2026-11-05');
    expect(cutoffPeriodEnd([cutoff(15)], '2026-12-20')?.date).toBe('2027-01-15');
    expect(cutoffPeriodEnd([], '2026-10-01')).toBeUndefined();
  });

  it('keeps a late cutoff inside a short month', () => {
    expect(cutoffPeriodEnd([cutoff(31)], '2026-11-10')?.date).toBe('2026-11-30');
    expect(cutoffPeriodEnd([cutoff(30)], '2027-02-10')?.date).toBe('2027-02-28');
  });
});

describe('cutoffDeadline', () => {
  it('without cutoffs is the field date plus the business days, at the close of that day', () => {
    // Thursday 1 October + 3 business days = Tuesday 6 October.
    expect(deadline('2026-10-01', 3)).toBe('2026-10-06T22:00:00.000Z');
  });

  it('never goes past the end of the cutoff period', () => {
    expect(deadline('2026-10-01', 3, [cutoff(5)])).toBe('2026-10-05T22:00:00.000Z');
    expect(deadline('2026-10-30', 10, [cutoff(5), cutoff(20)])).toBe('2026-11-05T22:00:00.000Z');
    expect(deadline('2026-10-01', 3, [cutoff(20)])).toBe('2026-10-06T22:00:00.000Z');
  });

  it('a cutoff on a day off is due at the close of the working day before', () => {
    // Saturday 3 October.
    expect(deadline('2026-10-01', 3, [cutoff(3)])).toBe('2026-10-02T22:00:00.000Z');
  });

  it('landing on a cutoff with grace adds those business days', () => {
    expect(deadline('2026-10-01', 3, [cutoff(5, 2)])).toBe('2026-10-07T22:00:00.000Z');
  });

  it("reads a DATETIME on the company's own day, and has nothing to count from while the field is blank", () => {
    // 03:00 UTC on 1 October is still 30 September in Bogotá.
    expect(deadline('2026-10-01T03:00:00.000Z', 1)).toBe('2026-10-01T22:00:00.000Z');
    expect(deadline('', 3)).toBeNull();
    expect(deadline(null, 3)).toBeNull();
    expect(deadline('not a date', 3)).toBeNull();
  });
});

describe('afterCurrentCutoff', () => {
  it('wakes up on the first working instant after the cutoff that closes the period, and its grace', () => {
    expect(afterCurrentCutoff([cutoff(5)], calendar, '2026-10-01')?.toISOString()).toBe('2026-10-06T13:00:00.000Z');
    expect(afterCurrentCutoff([cutoff(5, 1)], calendar, '2026-10-01')?.toISOString()).toBe('2026-10-07T13:00:00.000Z');
    // A cutoff on Saturday 3 October: Monday 5 October at 08:00.
    expect(afterCurrentCutoff([cutoff(3)], calendar, '2026-10-01')?.toISOString()).toBe('2026-10-05T13:00:00.000Z');
    expect(afterCurrentCutoff([], calendar, '2026-10-01')).toBeUndefined();
  });
});
