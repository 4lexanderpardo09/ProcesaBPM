/** `YYYY-MM-DD` of an instant in an IANA time zone (the "today" of a company). */
export function localDateIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
