import { InvalidCalendarError } from '../../errors/domain-error.js';
import type { BusinessCalendar } from './types.js';
import {
  addDaysToLocalDate,
  isValidTimeZone,
  localDateOf,
  weekdayOfLocalDate,
  zonedTimeToInstant,
} from './time-zone.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 24 * 60;

/** Half-open interval in epoch milliseconds. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

interface MinuteSlot {
  readonly startMinute: number;
  readonly endMinute: number;
}

function parseTime(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (match === null) throw new InvalidCalendarError(`Invalid time of day "${value}", expected HH:mm`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export class CompiledCalendar {
  private constructor(
    readonly timeZone: string,
    private readonly slotsByWeekday: readonly (readonly MinuteSlot[])[],
    private readonly holidays: ReadonlySet<string>,
  ) {}

  static from(calendar: BusinessCalendar): CompiledCalendar {
    if (!isValidTimeZone(calendar.timeZone)) {
      throw new InvalidCalendarError(`Unknown time zone "${calendar.timeZone}"`);
    }
    for (const holiday of calendar.holidays) {
      if (!DATE_PATTERN.test(holiday)) throw new InvalidCalendarError(`Invalid holiday date "${holiday}"`);
    }
    const slotsByWeekday: MinuteSlot[][] = Array.from({ length: 7 }, () => []);
    for (const slot of calendar.slots) {
      if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) {
        throw new InvalidCalendarError(`Invalid weekday ${slot.weekday}, expected 0 (Sunday) to 6 (Saturday)`);
      }
      const startMinute = parseTime(slot.startTime);
      const endMinute = slot.endTime === '24:00' ? MINUTES_PER_DAY : parseTime(slot.endTime);
      if (endMinute <= startMinute) {
        throw new InvalidCalendarError(`Slot ${slot.startTime}-${slot.endTime} must end after it starts`);
      }
      slotsByWeekday[slot.weekday]!.push({ startMinute, endMinute });
    }
    for (const slots of slotsByWeekday) {
      slots.sort((a, b) => a.startMinute - b.startMinute);
      slots.forEach((slot, index) => {
        if (index > 0 && slot.startMinute < slots[index - 1]!.endMinute) {
          throw new InvalidCalendarError('Working slots of the same weekday must not overlap');
        }
      });
    }
    if (slotsByWeekday.every((slots) => slots.length === 0)) {
      throw new InvalidCalendarError('A calendar needs at least one working slot');
    }
    return new CompiledCalendar(calendar.timeZone, slotsByWeekday, new Set(calendar.holidays));
  }

  localDate(instantMs: number): string {
    return localDateOf(instantMs, this.timeZone);
  }

  /** Working intervals of a local date, ordered; empty on holidays and non-working weekdays. */
  intervalsOn(date: string): Interval[] {
    if (this.holidays.has(date)) return [];
    return this.slotsByWeekday[weekdayOfLocalDate(date)]!.map((slot) => ({
      start: zonedTimeToInstant(date, slot.startMinute, this.timeZone),
      end: zonedTimeToInstant(date, slot.endMinute, this.timeZone),
    }));
  }

  /** Working intervals from `fromMs` on, clipped at `fromMs`, for at most `maxDays` local days. */
  *intervalsFrom(fromMs: number, maxDays: number): Generator<Interval & { date: string }> {
    let date = this.localDate(fromMs);
    for (let day = 0; day < maxDays; day += 1) {
      for (const interval of this.intervalsOn(date)) {
        if (interval.end > fromMs) yield { start: Math.max(interval.start, fromMs), end: interval.end, date };
      }
      date = addDaysToLocalDate(date, 1);
    }
  }
}
