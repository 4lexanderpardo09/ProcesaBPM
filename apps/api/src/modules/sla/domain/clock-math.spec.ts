import type { BusinessCalendar } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { closeSla, openSla } from './clock-math.js';

/** Monday to Friday 08:00-12:00 and 14:00-18:00 in Bogotá (UTC-5); Wednesday 2026-10-07 is a holiday. */
const calendar: BusinessCalendar = {
  timeZone: 'America/Bogota',
  slots: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startTime: '08:00', endTime: '12:00' },
    { weekday, startTime: '14:00', endTime: '18:00' },
  ]),
  holidays: ['2026-10-07'],
};
const monday9 = new Date('2026-10-05T14:00:00Z');

describe('openSla', () => {
  it('has no due date without an SLA, whatever the calendar', () => expect(openSla({ value: null, unit: null }, null, monday9)).toEqual({ value: null, unit: null, dueAt: null }));

  it('counts business hours, skipping the lunch break', () => {
    expect(openSla({ value: 4, unit: 'BUSINESS_HOURS' }, calendar, monday9).dueAt).toEqual(new Date('2026-10-05T20:00:00Z'));
  });

  it('counts business days to the end of the working day, skipping the holiday', () => {
    expect(openSla({ value: 1, unit: 'BUSINESS_DAYS' }, calendar, monday9).dueAt).toEqual(new Date('2026-10-06T23:00:00Z'));
    expect(openSla({ value: 2, unit: 'BUSINESS_DAYS' }, calendar, monday9).dueAt).toEqual(new Date('2026-10-08T23:00:00Z'));
  });

  it('keeps the copied terms', () => expect(openSla({ value: 8, unit: 'BUSINESS_HOURS' }, calendar, monday9)).toMatchObject({ value: 8, unit: 'BUSINESS_HOURS' }));

  it('refuses an SLA without a calendar', () => expect(() => openSla({ value: 1, unit: 'BUSINESS_DAYS' }, null, monday9)).toThrow('calendar'));
});

describe('closeSla', () => {
  const dueAt = new Date('2026-10-05T20:00:00Z');
  it('is on time up to the due instant, late after it', () => {
    expect(closeSla({ startedAt: monday9, completedAt: dueAt, dueAt, calendar }).result).toBe('ON_TIME');
    expect(closeSla({ startedAt: monday9, completedAt: new Date(dueAt.getTime() + 1), dueAt, calendar }).result).toBe('LATE');
  });
  it('measures business minutes, not elapsed time', () => {
    expect(closeSla({ startedAt: monday9, completedAt: new Date('2026-10-06T14:00:00Z'), dueAt, calendar }).businessMinutes).toBe(8 * 60);
  });
  it('has no result without a due date', () => expect(closeSla({ startedAt: monday9, completedAt: dueAt, dueAt: null, calendar }).result).toBeNull());
  it('has no minutes without a calendar', () => expect(closeSla({ startedAt: monday9, completedAt: dueAt, dueAt: null, calendar: null }).businessMinutes).toBeNull());
});
