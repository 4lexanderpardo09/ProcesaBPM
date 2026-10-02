import { InvalidCalendarError } from '../../errors/domain-error.js';
import { addBusinessDays, calculateDueDate, firstWorkingInstantOnOrAfter } from '../business-time/business-time.js';
import { localDateOf, localMinuteOfDay, zonedTimeToInstant } from '../business-time/time-zone.js';
import type { BusinessCalendar, SlaUnit } from '../business-time/types.js';

export type WaitConfig =
  | { readonly mode: 'DURATION'; readonly value: number; readonly unit: SlaUnit }
  | { readonly mode: 'UNTIL_FIELD_DATE'; readonly fieldCode: string; readonly offsetBusinessDays: number }
  | { readonly mode: 'COMPANY_CUTOFF' };

export type WaitPlan =
  | { readonly kind: 'PARK'; readonly resumeAt: Date }
  | { readonly kind: 'PASS'; readonly reason: 'ELAPSED' | 'FIELD_BLANK'; readonly waitedUntil?: Date };

export interface WaitInput {
  readonly config: WaitConfig;
  /** The ticket's values by field code. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly calendar: BusinessCalendar | null;
  readonly timeZone: string;
  readonly at: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function requireCalendar(calendar: BusinessCalendar | null): BusinessCalendar {
  if (calendar === null) throw new InvalidCalendarError('A WAIT block needs a business calendar');
  return calendar;
}

function untilFieldDate(config: Extract<WaitConfig, { mode: 'UNTIL_FIELD_DATE' }>, input: WaitInput): Date | undefined {
  const raw = input.values[config.fieldCode];
  if (typeof raw !== 'string' || raw === '') return undefined;
  const isDateOnly = DATE_ONLY.test(raw);
  const instant = isDateOnly ? Number.NaN : Date.parse(raw);
  if (!isDateOnly && Number.isNaN(instant)) return undefined;
  const day = isDateOnly ? raw : localDateOf(instant, input.timeZone);
  if (!isDateOnly && config.offsetBusinessDays === 0) return new Date(instant);

  const calendar = requireCalendar(input.calendar);
  const target = config.offsetBusinessDays === 0 ? day : addBusinessDays(calendar, day, config.offsetBusinessDays);
  if (isDateOnly) return firstWorkingInstantOnOrAfter(calendar, target);
  return new Date(zonedTimeToInstant(target, localMinuteOfDay(instant, input.timeZone), input.timeZone));
}

/**
 * When a ticket that reaches a WAIT block wakes up. Pure. A duration counts working time like an SLA does (a
 * business-days wait ends at the close of the Nth working day). A field date resumes at its working day, shifted by the
 * configured business days; a DATETIME field keeps its time of day. A blank field, or a moment already past, lets the
 * ticket straight through. `COMPANY_CUTOFF` is not available yet.
 */
export function planWait(input: WaitInput): WaitPlan {
  const { config, at } = input;
  if (config.mode === 'COMPANY_CUTOFF') throw new InvalidCalendarError('The company cutoff wait is not available yet');
  let resumeAt: Date | undefined;
  if (config.mode === 'DURATION') resumeAt = calculateDueDate({ start: at, amount: config.value, unit: config.unit, calendar: requireCalendar(input.calendar) });
  else {
    resumeAt = untilFieldDate(config, input);
    if (resumeAt === undefined) return { kind: 'PASS', reason: 'FIELD_BLANK' };
  }
  return resumeAt.getTime() <= at.getTime() ? { kind: 'PASS', reason: 'ELAPSED', waitedUntil: resumeAt } : { kind: 'PARK', resumeAt };
}
