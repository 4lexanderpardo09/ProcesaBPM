import type { BusinessCalendar } from '@procesabpm/shared';

/** `HH:mm` of a Prisma `time` value. */
export const formatTimeOfDay = (value: Date): string => value.toISOString().slice(11, 16);

/** `YYYY-MM-DD` of a Prisma `date` value. */
export const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

export interface StoredCalendar {
  readonly timeZone: string;
  readonly workingHours: ReadonlyArray<{ weekday: number; startTime: Date; endTime: Date }>;
  readonly holidays: ReadonlyArray<{ date: Date }>;
}

/** The calendar as the SLA engine of `packages/shared` expects it. */
export function toBusinessCalendar(stored: StoredCalendar): BusinessCalendar {
  return {
    timeZone: stored.timeZone,
    slots: stored.workingHours.map((slot) => ({ weekday: slot.weekday, startTime: formatTimeOfDay(slot.startTime), endTime: formatTimeOfDay(slot.endTime) })),
    holidays: stored.holidays.map((holiday) => formatDate(holiday.date)),
  };
}
