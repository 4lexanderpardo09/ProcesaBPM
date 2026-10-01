import { InvalidDurationError } from '../../errors/domain-error.js';
import { CompiledCalendar, type Interval } from './compiled-calendar.js';
import { normalizePauses, subtractPauses } from './intervals.js';
import { addDaysToLocalDate } from './time-zone.js';
import type { BusinessMinutesInput, DueDateInput } from './types.js';

const MS_PER_MINUTE = 60_000;
/** Upper bound of local days to scan; a calendar with working time always resolves far sooner. */
const MAX_SCAN_DAYS = 3660;
const MS_PER_DAY = 86_400_000;
/** Margin of two days so that daylight saving shifts never leave the end of a range unscanned. */
const MAX_RANGE_MS = (MAX_SCAN_DAYS - 2) * MS_PER_DAY;

function toMs(date: Date, label: string): number {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new InvalidDurationError(`${label} is not a valid date`);
  return ms;
}

function consumeBusinessMinutes(
  calendar: CompiledCalendar,
  fromMs: number,
  minutes: number,
  pauses: readonly Interval[],
): number {
  let remainingMs = minutes * MS_PER_MINUTE;
  for (const working of calendar.intervalsFrom(fromMs, MAX_SCAN_DAYS)) {
    for (const part of subtractPauses(working, pauses)) {
      const length = part.end - part.start;
      if (length >= remainingMs) return part.start + remainingMs;
      remainingMs -= length;
    }
  }
  throw new InvalidDurationError('The duration does not fit in the scan horizon of the calendar');
}

function firstWorkingInstant(calendar: CompiledCalendar, fromMs: number): { instant: number; date: string } {
  for (const working of calendar.intervalsFrom(fromMs, MAX_SCAN_DAYS)) {
    return { instant: working.start, date: working.date };
  }
  throw new InvalidDurationError('The calendar has no working time after the start');
}

function endOfNthBusinessDay(calendar: CompiledCalendar, firstDate: string, days: number): number {
  let date = firstDate;
  let counted = 0;
  for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned += 1) {
    date = addDaysToLocalDate(date, 1);
    const intervals = calendar.intervalsOn(date);
    if (intervals.length === 0) continue;
    counted += 1;
    if (counted === days) return intervals[intervals.length - 1]!.end;
  }
  throw new InvalidDurationError('The duration does not fit in the scan horizon of the calendar');
}

function sumBusinessMs(calendar: CompiledCalendar, startMs: number, endMs: number, pauses: readonly Interval[]): number {
  let total = 0;
  for (const working of calendar.intervalsFrom(startMs, MAX_SCAN_DAYS)) {
    if (working.start >= endMs) break;
    for (const part of subtractPauses({ start: working.start, end: Math.min(working.end, endMs) }, pauses)) {
      total += part.end - part.start;
    }
  }
  return total;
}

function assertPositive(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new InvalidDurationError('The SLA amount must be positive');
}

/**
 * Due date of an SLA.
 * - `BUSINESS_HOURS`: consumes working time only, skipping holidays and the paused periods.
 * - `BUSINESS_DAYS`: end of the working day that is `amount` business days after the day on which
 *   the clock effectively starts (a start outside working hours begins at the next slot); business
 *   minutes spent in pauses extend that deadline by exactly those business minutes, so with pauses
 *   the due date no longer falls at the end of the working day (decided).
 */
export function calculateDueDate(input: DueDateInput): Date {
  assertPositive(input.amount);
  const startMs = toMs(input.start, 'start');
  const calendar = CompiledCalendar.from(input.calendar);
  const pauses = normalizePauses(input.pauses);

  if (input.unit === 'BUSINESS_HOURS') {
    return new Date(consumeBusinessMinutes(calendar, startMs, Math.round(input.amount * 60), pauses));
  }

  if (!Number.isInteger(input.amount)) throw new InvalidDurationError('Business days must be a whole number');
  const effectiveStart = firstWorkingInstant(calendar, startMs);
  const baseDue = endOfNthBusinessDay(calendar, effectiveStart.date, input.amount);
  let extensionMs = 0;
  for (;;) {
    const due = extensionMs === 0 ? baseDue : consumeBusinessMinutes(calendar, baseDue, extensionMs / MS_PER_MINUTE, []);
    const pausedMs =
      sumBusinessMs(calendar, effectiveStart.instant, due, []) -
      sumBusinessMs(calendar, effectiveStart.instant, due, pauses);
    if (pausedMs === extensionMs) return new Date(due);
    extensionMs = pausedMs;
  }
}

/** Whole business minutes between two instants, excluding holidays, non-working time and pauses. */
export function businessMinutesBetween(input: BusinessMinutesInput): number {
  const startMs = toMs(input.start, 'start');
  const endMs = toMs(input.end, 'end');
  if (endMs < startMs) throw new InvalidDurationError('The end must not be before the start');
  if (endMs - startMs > MAX_RANGE_MS) throw new InvalidDurationError('The range exceeds the scan horizon of the calendar');
  const calendar = CompiledCalendar.from(input.calendar);
  return Math.floor(sumBusinessMs(calendar, startMs, endMs, normalizePauses(input.pauses)) / MS_PER_MINUTE);
}
