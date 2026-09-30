import { describe, expect, it } from 'vitest';
import { InvalidCalendarError, InvalidDurationError } from '../../errors/domain-error.js';
import { businessMinutesBetween, calculateDueDate } from './business-time.js';
import type { BusinessCalendar, PausePeriod, SlaUnit, WorkingSlot } from './types.js';

const weekdaySlots = (startTime: string, endTime: string, weekdays = [1, 2, 3, 4, 5]): WorkingSlot[] =>
  weekdays.map((weekday) => ({ weekday, startTime, endTime }));

/** Monday to Friday 08:00-12:00 and 14:00-18:00 in Bogotá (UTC-5, no daylight saving time). */
const bogota: BusinessCalendar = {
  timeZone: 'America/Bogota',
  slots: [...weekdaySlots('08:00', '12:00'), ...weekdaySlots('14:00', '18:00')],
  holidays: ['2026-01-12'],
};

const withSaturday: BusinessCalendar = {
  ...bogota,
  slots: [...bogota.slots, ...weekdaySlots('08:00', '12:00', [6])],
};

const newYork: BusinessCalendar = {
  timeZone: 'America/New_York',
  slots: weekdaySlots('09:00', '17:00'),
  holidays: [],
};

/** `2026-01-05T09:00` read as Bogotá local time. */
const at = (local: string): Date => new Date(`${local}:00-05:00`);
const iso = (date: Date): string => date.toISOString();

// January 2026: Mon 5, Mon 12 (holiday), Mon 19, Mon 26.
describe('calculateDueDate in business hours', () => {
  it.each([
    ['inside a slot', '2026-01-05T09:00', 2, '2026-01-05T11:00'],
    ['across the lunch break', '2026-01-05T11:00', 2, '2026-01-05T15:00'],
    ['ending exactly when a slot ends', '2026-01-05T16:00', 2, '2026-01-05T18:00'],
    ['starting at the lunch break', '2026-01-05T12:00', 1, '2026-01-05T15:00'],
    ['starting before opening hours', '2026-01-05T07:00', 1, '2026-01-05T09:00'],
    ['starting after closing hours', '2026-01-05T19:00', 1, '2026-01-06T09:00'],
    ['overflowing into the next day', '2026-01-05T17:00', 4, '2026-01-06T11:00'],
    ['starting on a Saturday', '2026-01-10T10:00', 1, '2026-01-13T09:00'],
    ['across a weekend', '2026-01-16T17:00', 2, '2026-01-19T09:00'],
    ['skipping a holiday', '2026-01-09T17:00', 2, '2026-01-13T09:00'],
    ['a half hour', '2026-01-05T09:00', 0.5, '2026-01-05T09:30'],
    ['a long duration', '2026-01-05T08:00', 40, '2026-01-09T18:00'],
  ])('%s', (_label, start, hours, expected) => {
    expect(iso(calculateDueDate({ start: at(start), amount: hours, unit: 'BUSINESS_HOURS', calendar: bogota }))).toBe(
      iso(at(expected)),
    );
  });

  it('reads the start as an instant, whatever zone it was written in', () => {
    const due = calculateDueDate({
      start: new Date('2026-01-05T14:00:00Z'),
      amount: 2,
      unit: 'BUSINESS_HOURS',
      calendar: bogota,
    });
    expect(iso(due)).toBe('2026-01-05T16:00:00.000Z');
  });

  it('keeps wall-clock hours across a daylight saving time change', () => {
    const due = calculateDueDate({
      start: new Date('2026-03-06T21:00:00Z'), // Friday 16:00 EST
      amount: 2,
      unit: 'BUSINESS_HOURS',
      calendar: newYork,
    });
    expect(iso(due)).toBe('2026-03-09T14:00:00.000Z'); // Monday 10:00 EDT
  });

  describe('with pauses', () => {
    const pause = (from: string, to: string): PausePeriod => ({ from: at(from), to: at(to) });

    it.each([
      ['a pause inside working time', '2026-01-05T09:00', 2, [pause('2026-01-05T10:00', '2026-01-05T10:30')], '2026-01-05T11:30'],
      ['a pause at the lunch break', '2026-01-05T11:00', 2, [pause('2026-01-05T12:30', '2026-01-05T13:30')], '2026-01-05T15:00'],
      ['a pause across non-working time', '2026-01-05T15:00', 3, [pause('2026-01-05T16:00', '2026-01-06T09:00')], '2026-01-06T11:00'],
      ['overlapping pauses', '2026-01-05T09:00', 1, [pause('2026-01-05T09:00', '2026-01-05T09:30'), pause('2026-01-05T09:15', '2026-01-05T10:00')], '2026-01-05T11:00'],
      ['a pause before the start', '2026-01-05T09:00', 1, [pause('2026-01-05T08:00', '2026-01-05T09:00')], '2026-01-05T10:00'],
    ])('discounts %s', (_label, start, hours, pauses, expected) => {
      const due = calculateDueDate({ start: at(start), amount: hours, unit: 'BUSINESS_HOURS', calendar: bogota, pauses });
      expect(iso(due)).toBe(iso(at(expected)));
    });
  });
});

describe('calculateDueDate in business days', () => {
  it.each([
    ['one day from a working morning', bogota, '2026-01-05T09:00', 1, '2026-01-06T18:00'],
    ['one day from the very start of the day', bogota, '2026-01-05T08:00', 1, '2026-01-06T18:00'],
    ['one day started after hours (begins next morning)', bogota, '2026-01-05T19:00', 1, '2026-01-07T18:00'],
    ['one day started before opening', bogota, '2026-01-05T06:00', 1, '2026-01-06T18:00'],
    ['one day over a weekend', bogota, '2026-01-16T10:00', 1, '2026-01-19T18:00'],
    ['one day over a weekend and a holiday', bogota, '2026-01-09T10:00', 1, '2026-01-13T18:00'],
    ['one day from a Saturday', bogota, '2026-01-10T10:00', 1, '2026-01-14T18:00'],
    ['five days', bogota, '2026-01-19T09:00', 5, '2026-01-26T18:00'],
    ['a Saturday with a shorter working day', withSaturday, '2026-01-16T10:00', 1, '2026-01-17T12:00'],
    ['the day after a Saturday', withSaturday, '2026-01-17T10:00', 1, '2026-01-19T18:00'],
  ])('%s', (_label, calendar, start, days, expected) => {
    expect(iso(calculateDueDate({ start: at(start), amount: days, unit: 'BUSINESS_DAYS', calendar }))).toBe(
      iso(at(expected)),
    );
  });

  it.each([
    [[{ from: at('2026-01-06T08:00'), to: at('2026-01-06T10:00') }], '2026-01-07T10:00'],
    [[{ from: at('2026-01-06T12:00'), to: at('2026-01-06T14:00') }], '2026-01-06T18:00'],
    [[{ from: at('2026-01-05T09:00'), to: at('2026-01-05T10:00') }, { from: at('2026-01-06T08:00'), to: at('2026-01-06T09:00') }], '2026-01-07T10:00'],
  ])('extends the deadline by the business time spent paused (%#)', (pauses, expected) => {
    const due = calculateDueDate({
      start: at('2026-01-05T09:00'),
      amount: 1,
      unit: 'BUSINESS_DAYS',
      calendar: bogota,
      pauses,
    });
    expect(iso(due)).toBe(iso(at(expected)));
  });
});

describe('calculateDueDate validation', () => {
  const base = { start: at('2026-01-05T09:00'), amount: 1, unit: 'BUSINESS_HOURS' as SlaUnit, calendar: bogota };

  it.each([
    ['zero', { amount: 0 }],
    ['negative', { amount: -2 }],
    ['not finite', { amount: Number.NaN }],
    ['fractional days', { amount: 1.5, unit: 'BUSINESS_DAYS' as SlaUnit }],
    ['an invalid start', { start: new Date('nope') }],
    ['a reversed pause', { pauses: [{ from: at('2026-01-05T10:00'), to: at('2026-01-05T09:00') }] }],
  ])('rejects %s', (_label, override) => {
    expect(() => calculateDueDate({ ...base, ...override })).toThrow(InvalidDurationError);
  });
});

describe('calendar validation', () => {
  const minutes = (calendar: BusinessCalendar) => () =>
    businessMinutesBetween({ start: at('2026-01-05T09:00'), end: at('2026-01-05T10:00'), calendar });

  it.each([
    ['an unknown time zone', { ...bogota, timeZone: 'Mars/Olympus' }],
    ['no slots', { ...bogota, slots: [] }],
    ['a weekday out of range', { ...bogota, slots: [{ weekday: 7, startTime: '08:00', endTime: '12:00' }] }],
    ['a malformed time', { ...bogota, slots: [{ weekday: 1, startTime: '8am', endTime: '12:00' }] }],
    ['a slot that ends before it starts', { ...bogota, slots: [{ weekday: 1, startTime: '12:00', endTime: '08:00' }] }],
    ['overlapping slots', { ...bogota, slots: [...weekdaySlots('08:00', '12:00'), ...weekdaySlots('11:00', '13:00')] }],
    ['a malformed holiday', { ...bogota, holidays: ['12/01/2026'] }],
  ])('rejects %s', (_label, calendar) => {
    expect(minutes(calendar)).toThrow(InvalidCalendarError);
  });

  it('accepts a slot that ends at midnight', () => {
    const calendar = { ...bogota, slots: weekdaySlots('20:00', '24:00') };
    expect(businessMinutesBetween({ start: at('2026-01-05T20:00'), end: at('2026-01-06T00:00'), calendar })).toBe(240);
  });
});

describe('businessMinutesBetween', () => {
  const between = (start: string, end: string, calendar = bogota, pauses: PausePeriod[] = []) =>
    businessMinutesBetween({ start: at(start), end: at(end), calendar, pauses });

  it.each([
    ['inside a slot', '2026-01-05T09:00', '2026-01-05T11:00', 120],
    ['across the lunch break', '2026-01-05T11:00', '2026-01-05T15:00', 120],
    ['only non-working time', '2026-01-05T18:00', '2026-01-06T08:00', 0],
    ['across a weekend', '2026-01-16T17:00', '2026-01-19T09:00', 120],
    ['across a holiday', '2026-01-09T17:00', '2026-01-13T09:00', 120],
    ['a whole working week', '2026-01-19T00:00', '2026-01-24T00:00', 5 * 8 * 60],
    ['an empty range', '2026-01-05T09:00', '2026-01-05T09:00', 0],
  ])('counts %s', (_label, start, end, expected) => {
    expect(between(start, end)).toBe(expected);
  });

  it('counts Saturday slots when the calendar has them', () => {
    expect(between('2026-01-17T00:00', '2026-01-18T00:00', withSaturday)).toBe(240);
  });

  it('discounts pauses', () => {
    const pause = { from: at('2026-01-05T10:00'), to: at('2026-01-05T11:00') };
    expect(between('2026-01-05T09:00', '2026-01-05T12:00', bogota, [pause])).toBe(120);
  });

  it('floors partial minutes', () => {
    const start = at('2026-01-05T09:00');
    const end = new Date(start.getTime() + 59_000);
    expect(businessMinutesBetween({ start, end, calendar: bogota })).toBe(0);
  });

  it('rejects a range that ends before it starts', () => {
    expect(() => between('2026-01-05T10:00', '2026-01-05T09:00')).toThrow(InvalidDurationError);
  });

  it.each([
    ['2026-01-05T09:00', 3],
    ['2026-01-05T17:00', 10],
    ['2026-01-10T10:00', 7.5],
    ['2026-01-09T16:30', 20],
  ])('agrees with calculateDueDate for a start at %s and %s hours', (start, hours) => {
    const due = calculateDueDate({ start: at(start), amount: hours, unit: 'BUSINESS_HOURS', calendar: bogota });
    expect(businessMinutesBetween({ start: at(start), end: due, calendar: bogota })).toBe(hours * 60);
  });
});
