import { addBusinessDays, endOfWorkingDayOnOrBefore, firstWorkingInstantOnOrAfter } from '../business-time/business-time.js';
import { localDateOf } from '../business-time/time-zone.js';
import type { BusinessCalendar } from '../business-time/types.js';

/** A company's monthly cutoff for one workflow: the day of the month, and the business days of grace it gives. */
export interface CutoffTerm {
  readonly day: number;
  readonly graceBusinessDays: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, '0');

/** The cutoff day in a month, kept inside it: a cutoff on the 31st falls on the 30th of a 30-day month. */
function onMonth(year: number, month: number, day: number): string {
  const normalizedYear = year + Math.floor((month - 1) / 12);
  const normalizedMonth = ((((month - 1) % 12) + 12) % 12) + 1;
  return `${String(normalizedYear)}-${pad(normalizedMonth)}-${pad(Math.min(day, daysInMonth(normalizedYear, normalizedMonth)))}`;
}

/**
 * The end of the cutoff period a local date belongs to: the first cutoff of that month on or after its day, or the
 * first cutoff of the next month when none is left. `undefined` without cutoffs.
 */
export function cutoffPeriodEnd(cutoffs: readonly CutoffTerm[], date: string): { readonly date: string; readonly cutoff: CutoffTerm } | undefined {
  const sorted = [...cutoffs].sort((left, right) => left.day - right.day);
  if (sorted.length === 0) return undefined;
  const [year, month] = date.split('-').map(Number) as [number, number];
  const sameMonth = sorted.map((cutoff) => ({ date: onMonth(year, month, cutoff.day), cutoff })).find((candidate) => candidate.date >= date);
  return sameMonth ?? { date: onMonth(year, month + 1, sorted[0]!.day), cutoff: sorted[0]! };
}

/** The local date of a DATE (`YYYY-MM-DD`) or DATETIME value; `undefined` when blank or not a date. */
export function localDateOfValue(value: unknown, timeZone: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (DATE_ONLY.test(value)) return value;
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? undefined : localDateOf(instant, timeZone);
}

export interface CutoffDeadlineInput {
  /** The value of the step's date field. */
  readonly base: unknown;
  readonly businessDays: number;
  readonly cutoffs: readonly CutoffTerm[];
  readonly calendar: BusinessCalendar;
  readonly timeZone: string;
}

/**
 * Due date of a step whose deadline is a CUTOFF, as the help desk computed it: the field's date plus N business
 * days, but never past the end of the company's cutoff period; landing on a cutoff with grace adds those business
 * days. The deadline is the close of that working day (or of the last working day before it). `null` while the field
 * is blank: there is nothing to count from yet.
 */
export function cutoffDeadline(input: CutoffDeadlineInput): Date | null {
  const baseDate = localDateOfValue(input.base, input.timeZone);
  if (baseDate === undefined) return null;
  let deadline = addBusinessDays(input.calendar, baseDate, input.businessDays);
  const periodEnd = cutoffPeriodEnd(input.cutoffs, baseDate);
  if (periodEnd !== undefined && periodEnd.date < deadline) deadline = periodEnd.date;
  const day = Number(deadline.slice(8, 10));
  const grace = input.cutoffs.find((cutoff) => cutoff.graceBusinessDays > 0 && (cutoff.day === day || cutoffPeriodEnd([cutoff], deadline)?.date === deadline));
  if (grace !== undefined) deadline = addBusinessDays(input.calendar, deadline, grace.graceBusinessDays);
  return endOfWorkingDayOnOrBefore(input.calendar, deadline);
}

/**
 * When a ticket waiting for the company's cutoff wakes up: the first working instant after the cutoff that closes the
 * current period (and after its grace days). `undefined` without cutoffs, so the ticket goes straight through.
 */
export function afterCurrentCutoff(cutoffs: readonly CutoffTerm[], calendar: BusinessCalendar, today: string): Date | undefined {
  const periodEnd = cutoffPeriodEnd(cutoffs, today);
  if (periodEnd === undefined) return undefined;
  const lastDay = periodEnd.cutoff.graceBusinessDays > 0 ? addBusinessDays(calendar, periodEnd.date, periodEnd.cutoff.graceBusinessDays) : periodEnd.date;
  return firstWorkingInstantOnOrAfter(calendar, addCalendarDay(lastDay));
}

function addCalendarDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${String(next.getUTCFullYear())}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
