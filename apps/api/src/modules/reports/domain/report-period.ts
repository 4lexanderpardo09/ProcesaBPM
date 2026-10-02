const HOUR_MS = 3_600_000;
/** The largest offset between UTC and a local time (UTC+14). */
const MAX_OFFSET_HOURS = 14;

export interface PeriodBounds {
  readonly from: string;
  readonly to: string;
  /** A UTC range that surely contains the period in every time zone: it lets the database use an index. */
  readonly coarseLow: Date;
  readonly coarseHigh: Date;
}

/**
 * The local days `from` and `to` (both included). The exact boundaries are applied in SQL with each ticket's company
 * zone; these coarse bounds only narrow the rows read, so a ticket near midnight is never wrongly left out.
 */
export function periodBounds(from: string, to: string): PeriodBounds {
  const start = Date.parse(`${from}T00:00:00Z`);
  const afterEnd = Date.parse(`${to}T00:00:00Z`) + 24 * HOUR_MS;
  return { from, to, coarseLow: new Date(start - MAX_OFFSET_HOURS * HOUR_MS), coarseHigh: new Date(afterEnd + MAX_OFFSET_HOURS * HOUR_MS) };
}
