const LOCALE = 'es-CO';

/** Date and time in Spanish; the browser's time zone unless another is given (before sign-in there is no profile). */
export function formatDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeStyle: 'short', ...(timeZone === undefined ? {} : { timeZone }) }).format(date);
}
