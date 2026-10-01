export type SlaUnit = 'BUSINESS_HOURS' | 'BUSINESS_DAYS';

/** 0 = Sunday … 6 = Saturday (same as PostgreSQL `EXTRACT(DOW …)` and `Date#getDay`). */
export interface WorkingSlot {
  readonly weekday: number;
  /** Local time of day, `HH:mm`. */
  readonly startTime: string;
  /** Local time of day, `HH:mm`; must be after `startTime` (night shifts are split in two slots). */
  readonly endTime: string;
}

export interface BusinessCalendar {
  /** IANA time zone, e.g. `America/Bogota`. */
  readonly timeZone: string;
  readonly slots: readonly WorkingSlot[];
  /** Local dates (`YYYY-MM-DD`) with no working time. */
  readonly holidays: readonly string[];
}

/** A period in which the SLA clock is stopped (ticket incident). */
export interface PausePeriod {
  readonly from: Date;
  readonly to: Date;
}

export interface DueDateInput {
  readonly start: Date;
  readonly amount: number;
  readonly unit: SlaUnit;
  readonly calendar: BusinessCalendar;
  readonly pauses?: readonly PausePeriod[];
}

export interface BusinessMinutesInput {
  readonly start: Date;
  readonly end: Date;
  readonly calendar: BusinessCalendar;
  readonly pauses?: readonly PausePeriod[];
}
