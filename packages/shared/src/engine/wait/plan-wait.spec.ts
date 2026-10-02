import { describe, expect, it } from 'vitest';
import { InvalidCalendarError } from '../../errors/domain-error.js';
import type { BusinessCalendar } from '../business-time/types.js';
import { planWait, type WaitConfig } from './plan-wait.js';

/** Monday to Friday 08:00-12:00 and 14:00-18:00 in Bogota (UTC-5), Monday 2026-10-12 a holiday. */
const calendar: BusinessCalendar = {
  timeZone: 'America/Bogota',
  slots: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startTime: '08:00', endTime: '12:00' },
    { weekday, startTime: '14:00', endTime: '18:00' },
  ]),
  holidays: ['2026-10-12'],
};
// Friday 2026-10-09 10:00 Bogota.
const at = new Date('2026-10-09T15:00:00.000Z');
const plan = (config: WaitConfig, values: Record<string, unknown> = {}, cal: BusinessCalendar | null = calendar) => planWait({ config, values, calendar: cal, timeZone: 'America/Bogota', at });
const iso = (result: ReturnType<typeof plan>) => (result.kind === 'PARK' ? result.resumeAt.toISOString() : result);

describe('planWait: DURATION', () => {
  it('counts working hours', () => expect(iso(plan({ mode: 'DURATION', value: 4, unit: 'BUSINESS_HOURS' }))).toBe('2026-10-09T21:00:00.000Z'));
  it('ends a business-days wait at the close of the Nth working day, skipping weekends and holidays', () => {
    // Fri +1 working day skips Sat, Sun and the Monday holiday: Tuesday 18:00.
    expect(iso(plan({ mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' }))).toBe('2026-10-13T23:00:00.000Z');
  });
  it('needs a calendar', () => expect(() => plan({ mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' }, {}, null)).toThrow(InvalidCalendarError));
});

describe('planWait: UNTIL_FIELD_DATE', () => {
  const until = (offset: number, value: unknown) => plan({ mode: 'UNTIL_FIELD_DATE', fieldCode: 'DUE', offsetBusinessDays: offset }, { DUE: value });

  it('lets the ticket through when the field is blank', () => {
    expect(until(0, undefined)).toEqual({ kind: 'PASS', reason: 'FIELD_BLANK' });
    expect(until(0, '')).toEqual({ kind: 'PASS', reason: 'FIELD_BLANK' });
  });

  it('resumes a DATE field at the first working instant of that day', () => {
    expect(iso(until(0, '2026-10-14'))).toBe('2026-10-14T13:00:00.000Z');
    // A holiday moves it to the next working day.
    expect(iso(until(0, '2026-10-12'))).toBe('2026-10-13T13:00:00.000Z');
  });

  it('shifts by business days, forward and backward', () => {
    expect(iso(until(2, '2026-10-14'))).toBe('2026-10-16T13:00:00.000Z');
    expect(iso(until(-1, '2026-10-14'))).toBe('2026-10-13T13:00:00.000Z');
    expect(iso(until(1, '2026-10-09'))).toBe('2026-10-13T13:00:00.000Z');
  });

  it('keeps the exact instant of a DATETIME field with no offset, and its time of day with an offset', () => {
    expect(iso(until(0, '2026-10-14T20:30:00.000Z'))).toBe('2026-10-14T20:30:00.000Z');
    // 15:30 Bogota on Wednesday + 1 working day = Thursday 15:30 Bogota.
    expect(iso(until(1, '2026-10-14T20:30:00.000Z'))).toBe('2026-10-15T20:30:00.000Z');
  });

  it('lets the ticket through when the moment has passed', () => {
    expect(until(0, '2026-10-09T14:00:00.000Z')).toEqual({ kind: 'PASS', reason: 'ELAPSED', waitedUntil: new Date('2026-10-09T14:00:00.000Z') });
    expect(until(0, '2026-10-01')).toMatchObject({ kind: 'PASS', reason: 'ELAPSED' });
  });

  it('needs a calendar for a date-only field or an offset, not for an exact DATETIME', () => {
    expect(() => plan({ mode: 'UNTIL_FIELD_DATE', fieldCode: 'DUE', offsetBusinessDays: 0 }, { DUE: '2026-10-14' }, null)).toThrow(InvalidCalendarError);
    expect(plan({ mode: 'UNTIL_FIELD_DATE', fieldCode: 'DUE', offsetBusinessDays: 0 }, { DUE: '2026-10-14T20:30:00.000Z' }, null)).toMatchObject({ kind: 'PARK' });
  });
});

it('refuses the company cutoff mode', () => expect(() => plan({ mode: 'COMPANY_CUTOFF' })).toThrow(InvalidCalendarError));
