import type { BusinessCalendar } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { pausePeriodsOf, resumeSla } from './pause-math.js';

/** Monday to Friday 08-12 and 14-18 in Bogotá (UTC-5); Wednesday 2026-09-09 is a holiday. */
const calendar: BusinessCalendar = {
  timeZone: 'America/Bogota',
  slots: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startTime: '08:00', endTime: '12:00' },
    { weekday, startTime: '14:00', endTime: '18:00' },
  ]),
  holidays: ['2026-09-09'],
};
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const hours = (value: number) => ({ value, unit: 'BUSINESS_HOURS' as const });
const days = (value: number) => ({ value, unit: 'BUSINESS_DAYS' as const });

const resume = (terms: ReturnType<typeof hours> | ReturnType<typeof days>, startedAt: Date, openedAt: Date, resolvedAt: Date, earlier: Array<[Date, Date]> = []) => {
  const pauses = [...earlier, [openedAt, resolvedAt] as [Date, Date]].map(([from, to]) => ({ from, to }));
  return resumeSla({ startedAt, terms, calendar, pauses, pausedAt: openedAt, resumedAt: resolvedAt, pausedMinutes: 0 });
};

describe('pausePeriodsOf', () => {
  it('closes an open incident at the given instant and drops empty periods', () => {
    const until = bogota('2026-09-07', '12:00');
    expect(pausePeriodsOf([{ openedAt: bogota('2026-09-07', '10:00'), resolvedAt: null }, { openedAt: until, resolvedAt: until }], until)).toEqual([{ from: bogota('2026-09-07', '10:00'), to: until }]);
  });
});

describe('resumeSla', () => {
  it('a pause across the night moves the due date by the business minutes it covered', () => {
    const result = resume(hours(4), bogota('2026-09-07', '09:00'), bogota('2026-09-07', '10:00'), bogota('2026-09-08', '10:00'));
    expect(result.pausedMinutes).toBe(8 * 60);
    expect(result.dueAt).toEqual(bogota('2026-09-08', '15:00'));
  });

  it('a pause over a weekend counts only the working time before it (business days)', () => {
    const result = resume(days(2), bogota('2026-09-08', '09:00'), bogota('2026-09-11', '17:00'), bogota('2026-09-14', '09:00'));
    expect(result.pausedMinutes).toBe(120);
    expect(result.dueAt).toEqual(bogota('2026-09-14', '10:00'));
  });

  it('a pause over a holiday does not count the holiday', () => {
    const result = resume(hours(4), bogota('2026-09-08', '16:00'), bogota('2026-09-08', '17:00'), bogota('2026-09-10', '09:00'));
    expect(result.pausedMinutes).toBe(120);
    expect(result.dueAt).toEqual(bogota('2026-09-10', '12:00'));
  });

  it('a pause after the due date moves nothing', () => {
    const result = resume(hours(1), bogota('2026-09-07', '09:00'), bogota('2026-09-07', '11:00'), bogota('2026-09-08', '09:00'));
    expect(result.dueAt).toEqual(bogota('2026-09-07', '10:00'));
    expect(result.pausedMinutes).toBe(360);
  });

  it('two incidents add up', () => {
    const first: [Date, Date] = [bogota('2026-09-07', '09:30'), bogota('2026-09-07', '10:30')];
    const result = resumeSla({
      startedAt: bogota('2026-09-07', '09:00'),
      terms: hours(4),
      calendar,
      pauses: [{ from: first[0], to: first[1] }, { from: bogota('2026-09-07', '11:00'), to: bogota('2026-09-07', '14:30') }],
      pausedAt: bogota('2026-09-07', '11:00'),
      resumedAt: bogota('2026-09-07', '14:30'),
      pausedMinutes: 60,
    });
    expect(result.pausedMinutes).toBe(60 + 90);
    expect(result.dueAt).toEqual(bogota('2026-09-07', '17:30'));
  });

  it('without an SLA there is no due date, and without a calendar nothing is measured', () => {
    expect(resumeSla({ startedAt: bogota('2026-09-07', '09:00'), terms: { value: null, unit: null }, calendar, pauses: [], pausedAt: bogota('2026-09-07', '10:00'), resumedAt: bogota('2026-09-07', '11:00'), pausedMinutes: 0 })).toEqual({ dueAt: null, pausedMinutes: 60 });
    expect(resumeSla({ startedAt: bogota('2026-09-07', '09:00'), terms: hours(4), calendar: null, pauses: [], pausedAt: bogota('2026-09-07', '10:00'), resumedAt: bogota('2026-09-07', '11:00'), pausedMinutes: 5 })).toEqual({ dueAt: null, pausedMinutes: 5 });
  });
});
