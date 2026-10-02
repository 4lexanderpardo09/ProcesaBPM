const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function localParts(instantMs: number, timeZone: string): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** Offset of the zone from UTC at that instant, in milliseconds. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Minutes since local midnight at that instant. */
export function localMinuteOfDay(instantMs: number, timeZone: string): number {
  const p = localParts(instantMs, timeZone);
  return p.hour! * 60 + p.minute!;
}

export function localDateOf(instantMs: number, timeZone: string): string {
  const p = localParts(instantMs, timeZone);
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}`;
}

/** Instant at which the wall clock of `timeZone` shows `minuteOfDay` on the local `date` (`YYYY-MM-DD`). */
export function zonedTimeToInstant(date: string, minuteOfDay: number, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  return wallAsUtc - offsetMs(firstGuess, timeZone);
}

export function addDaysToLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

export function weekdayOfLocalDate(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
