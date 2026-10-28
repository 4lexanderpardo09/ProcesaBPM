/** How many months the AI usage page offers: the token ledger is kept 13 months. */
export const USAGE_MONTHS = 13;

export interface UsageMonth {
  /** `YYYY-MM`. */
  readonly value: string;
  /** First and last calendar day, as the API reads them (UTC). */
  readonly from: string;
  readonly to: string;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The month `value` (`YYYY-MM`) as a period of days. */
export function usageMonthOf(value: string): UsageMonth {
  const [year, month] = value.split('-').map(Number) as [number, number];
  return { value, from: isoDay(new Date(Date.UTC(year, month - 1, 1))), to: isoDay(new Date(Date.UTC(year, month, 0))) };
}

/** The current UTC month and the twelve before it, the newest first. */
export function recentUsageMonths(now: Date): UsageMonth[] {
  return Array.from({ length: USAGE_MONTHS }, (_, index) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return usageMonthOf(start.toISOString().slice(0, 7));
  });
}

const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** «octubre de 2026». */
export const usageMonthLabel = (month: UsageMonth): string => monthName.format(new Date(`${month.from}T00:00:00Z`));
