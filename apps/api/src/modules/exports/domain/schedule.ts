import { addDaysToLocalDate, type ExportSchedule, localDateOf, weekdayOfLocalDate, zonedTimeToInstant } from '@procesabpm/shared';

/** How far back and ahead an occurrence is looked for: more than any month. */
const SCAN_DAYS = 62;

const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const daysInMonth = (date: string) => {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
/** 1 = Monday … 7 = Sunday. */
const isoWeekday = (date: string) => {
  const day = weekdayOfLocalDate(date);
  return day === 0 ? 7 : day;
};

/** Whether the schedule runs on a local date (EVERY_N_DAYS counts from the last run, not from the calendar). */
function runsOn(schedule: ExportSchedule, date: string): boolean {
  switch (schedule.frequency) {
    case 'WEEKLY':
      return schedule.weekdays.includes(isoWeekday(date));
    case 'MONTHLY':
      return Number(date.slice(8, 10)) === Math.min(schedule.monthDay ?? 1, daysInMonth(date));
    default:
      return true;
  }
}

const occurrenceOn = (schedule: ExportSchedule, date: string, timeZone: string) => new Date(zonedTimeToInstant(date, minuteOf(schedule.cutoffTime), timeZone));

/** The latest scheduled moment at or before `now` (DAILY, WEEKLY and MONTHLY). */
export function lastOccurrence(schedule: ExportSchedule, now: Date, timeZone: string): Date | null {
  let date = localDateOf(now.getTime(), timeZone);
  for (let scanned = 0; scanned <= SCAN_DAYS; scanned += 1) {
    if (runsOn(schedule, date)) {
      const at = occurrenceOn(schedule, date, timeZone);
      if (at.getTime() <= now.getTime()) return at;
    }
    date = addDaysToLocalDate(date, -1);
  }
  return null;
}

/**
 * The next scheduled moment after `now`. EVERY_N_DAYS runs N days after its last automatic run at the cutoff time,
 * and the first time as soon as that time of day comes.
 */
export function nextOccurrence(schedule: ExportSchedule, now: Date, timeZone: string, lastRun: Date | null): Date | null {
  if (schedule.frequency === 'EVERY_N_DAYS') {
    const today = localDateOf(now.getTime(), timeZone);
    if (lastRun === null) {
      // Never run: due today at the cutoff time (if that already passed, it is due now).
      return occurrenceOn(schedule, today, timeZone);
    }
    return occurrenceOn(schedule, addDaysToLocalDate(localDateOf(lastRun.getTime(), timeZone), schedule.intervalDays ?? 1), timeZone);
  }
  let date = localDateOf(now.getTime(), timeZone);
  for (let scanned = 0; scanned <= SCAN_DAYS; scanned += 1) {
    if (runsOn(schedule, date)) {
      const at = occurrenceOn(schedule, date, timeZone);
      if (at.getTime() > now.getTime()) return at;
    }
    date = addDaysToLocalDate(date, 1);
  }
  return null;
}

/**
 * Whether the scheduled cutoff is due now: its latest moment has passed since the last automatic run. The worker runs
 * every few minutes, so a cutoff it missed (a restart) still runs once, late, and never twice.
 */
export function isCutoffDue(schedule: ExportSchedule, now: Date, timeZone: string, lastRun: Date | null): boolean {
  if (schedule.frequency === 'EVERY_N_DAYS') {
    const next = nextOccurrence(schedule, now, timeZone, lastRun);
    return next !== null && next.getTime() <= now.getTime();
  }
  const last = lastOccurrence(schedule, now, timeZone);
  return last !== null && (lastRun === null || lastRun.getTime() < last.getTime());
}
