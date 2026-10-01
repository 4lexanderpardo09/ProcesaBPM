import { type BusinessCalendar, businessMinutesBetween, calculateDueDate, InvalidCalendarError, type PausePeriod, type SlaUnit } from '@procesabpm/shared';

export type SlaResult = 'ON_TIME' | 'LATE';

/** The SLA of a visit or a clock: copied when it opens, so later edits of the workflow never change it. */
export interface SlaTerms {
  readonly value: number | null;
  readonly unit: SlaUnit | null;
}

export interface OpenedSla extends SlaTerms {
  readonly dueAt: Date | null;
}

export interface ClosedSla {
  /** `null` only when there is no calendar to measure with (and so no SLA either). */
  readonly businessMinutes: number | null;
  /** `null` when there is no SLA to be late for. */
  readonly result: SlaResult | null;
}

/** Due date of an SLA that starts at `at`; no SLA, no due date. A SLA without a calendar is a configuration error. */
export function openSla(terms: SlaTerms, calendar: BusinessCalendar | null, at: Date): OpenedSla {
  if (terms.value === null || terms.unit === null) return { value: null, unit: null, dueAt: null };
  if (calendar === null) throw new InvalidCalendarError('The company has no calendar to measure the SLA with');
  return { ...terms, dueAt: calculateDueDate({ start: at, amount: terms.value, unit: terms.unit, calendar }) };
}

/** Business minutes used between `startedAt` and `completedAt`, and whether the due date was met. */
export function closeSla(input: { startedAt: Date; completedAt: Date; dueAt: Date | null; calendar: BusinessCalendar | null; pauses?: readonly PausePeriod[] }): ClosedSla {
  const businessMinutes = input.calendar === null ? null : businessMinutesBetween({ start: input.startedAt, end: input.completedAt, calendar: input.calendar, ...(input.pauses === undefined ? {} : { pauses: input.pauses }) });
  const result: SlaResult | null = input.dueAt === null ? null : input.completedAt.getTime() <= input.dueAt.getTime() ? 'ON_TIME' : 'LATE';
  return { businessMinutes, result };
}
