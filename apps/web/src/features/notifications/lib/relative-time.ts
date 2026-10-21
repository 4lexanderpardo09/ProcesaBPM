import { formatShortDate } from '@/shared/lib/format-date-time';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const relative = new Intl.RelativeTimeFormat('es-CO', { numeric: 'auto' });

/** "hace 5 minutos", "ayer"; after a week, the date. A time in the future (clock skew) reads as now. */
export function formatRelativeTime(iso: string, now: Date, timeZone?: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const elapsed = Math.max(0, now.getTime() - then.getTime());
  if (elapsed < MINUTE) return relative.format(0, 'second');
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < WEEK) return relative.format(-Math.floor(elapsed / DAY), 'day');
  return formatShortDate(iso, timeZone);
}
