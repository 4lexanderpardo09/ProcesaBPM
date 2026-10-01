import { businessMinutesBetween, type BusinessCalendar, calculateDueDate, type PausePeriod } from '@procesabpm/shared';
import type { SlaTerms } from './clock-math.js';

export interface IncidentPeriod {
  readonly openedAt: Date;
  /** `null` while the incident is open. */
  readonly resolvedAt: Date | null;
}

/** The periods a ticket's clocks stood still, as the SLA math takes them; an open incident lasts until `until`. */
export function pausePeriodsOf(incidents: readonly IncidentPeriod[], until: Date): PausePeriod[] {
  return incidents.map((incident) => ({ from: incident.openedAt, to: incident.resolvedAt ?? until })).filter((period) => period.to.getTime() > period.from.getTime());
}

export interface ResumeInput {
  readonly startedAt: Date;
  readonly terms: SlaTerms;
  readonly calendar: BusinessCalendar | null;
  /** Every pause of the ticket up to now, the one being closed included. */
  readonly pauses: readonly PausePeriod[];
  readonly pausedAt: Date;
  readonly resumedAt: Date;
  /** Business minutes already spent paused by earlier incidents. */
  readonly pausedMinutes: number;
}

export interface ResumedSla {
  readonly dueAt: Date | null;
  readonly pausedMinutes: number;
}

/**
 * What a clock (or a visit) gets back when an incident is resolved: the business minutes it stood still are
 * added to `pausedMinutes`, and the due date is recomputed from the start with all the pauses, so it moves
 * by exactly those business minutes. A pause after the due date moves nothing: a late clock stays late.
 */
export function resumeSla(input: ResumeInput): ResumedSla {
  const { calendar, terms } = input;
  if (calendar === null) return { dueAt: null, pausedMinutes: input.pausedMinutes };
  const paused = businessMinutesBetween({ start: input.pausedAt, end: input.resumedAt, calendar });
  const dueAt = terms.value === null || terms.unit === null ? null : calculateDueDate({ start: input.startedAt, amount: terms.value, unit: terms.unit, calendar, pauses: input.pauses });
  return { dueAt, pausedMinutes: input.pausedMinutes + paused };
}
