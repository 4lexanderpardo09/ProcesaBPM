const LOCALE = 'es-CO';

/** Date and time in Spanish; the browser's time zone unless another is given (before sign-in there is no profile). */
export function formatDateTime(iso: string, timeZone?: string): string {
  return format(iso, { dateStyle: 'long', timeStyle: 'short' }, timeZone);
}

/** A short date for tables ("18 oct 2026"). */
export function formatShortDate(iso: string, timeZone?: string): string {
  return format(iso, { day: 'numeric', month: 'short', year: 'numeric' }, timeZone);
}

function format(iso: string, options: Intl.DateTimeFormatOptions, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { ...options, ...(timeZone === undefined ? {} : { timeZone }) }).format(date);
}
