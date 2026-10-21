import type { WorkingHoursResponse } from '@procesabpm/shared';

/** Monday first, as the week reads in Colombia; the API numbers the days 0 = Sunday … 6 = Saturday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export type Weekday = (typeof WEEK_ORDER)[number];

/** The API accepts at most this many slots in one day. */
export const MAX_SLOTS_PER_DAY = 10;

export interface Slot {
  readonly startTime: string;
  readonly endTime: string;
}

/** The slots of one weekday, earliest first. */
export function slotsOf(hours: readonly WorkingHoursResponse[], weekday: number): Slot[] {
  return hours
    .filter((slot) => slot.weekday === weekday)
    .map(({ startTime, endTime }) => ({ startTime, endTime }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Working minutes in the whole week, to show how much one calendar counts against another. */
export function weeklyMinutes(hours: readonly WorkingHoursResponse[]): number {
  return hours.reduce((total, slot) => total + minutesOf(slot.endTime) - minutesOf(slot.startTime), 0);
}

export type SlotIssue = 'incomplete' | 'endsBeforeStart' | 'overlaps';

/**
 * What is wrong with each slot of a day, by its index. A slot must end after it starts (a night shift is split in
 * two), and two slots must not overlap: the hours in common would count twice.
 */
export function slotIssues(slots: readonly Slot[]): ReadonlyMap<number, SlotIssue> {
  const issues = new Map<number, SlotIssue>();
  slots.forEach((slot, index) => {
    if (slot.startTime === '' || slot.endTime === '') issues.set(index, 'incomplete');
    else if (slot.startTime >= slot.endTime) issues.set(index, 'endsBeforeStart');
  });
  const ordered = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ index }) => !issues.has(index))
    .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
  let previousEnd = '';
  for (const { slot, index } of ordered) {
    if (slot.startTime < previousEnd) issues.set(index, 'overlaps');
    if (slot.endTime > previousEnd) previousEnd = slot.endTime;
  }
  return issues;
}
