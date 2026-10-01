import { z } from 'zod';
import { isoDateSchema, nameSchema, timeOfDaySchema } from '../common.js';
import { uuidSchema } from '../ids.js';

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Use the two-letter country code in capitals');
const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Use the three-letter currency code in capitals');
const timeZoneSchema = z.string().trim().min(1).max(64);

// ---- Companies ----
/** Currency and time zone default to those of the country. */
export const createCompanyRequestSchema = z.object({
  name: nameSchema,
  taxId: z.string().trim().min(1).max(50).optional(),
  countryCode: countryCodeSchema,
  currencyCode: currencyCodeSchema.optional(),
  timeZone: timeZoneSchema.optional(),
  calendarId: uuidSchema.optional(),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;

export const updateCompanyRequestSchema = z
  .object({
    name: nameSchema,
    taxId: z.string().trim().min(1).max(50).nullable(),
    countryCode: countryCodeSchema,
    currencyCode: currencyCodeSchema,
    timeZone: timeZoneSchema,
    calendarId: uuidSchema.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequestSchema>;

export const companyResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  taxId: z.string().nullable(),
  countryCode: z.string(),
  currencyCode: z.string(),
  timeZone: z.string(),
  calendarId: uuidSchema.nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type CompanyResponse = z.infer<typeof companyResponseSchema>;

// ---- Departments and positions (a name, unique per tenant) ----
export const namedRecordRequestSchema = z.object({ name: nameSchema });
export type NamedRecordRequest = z.infer<typeof namedRecordRequestSchema>;

export const namedRecordResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type NamedRecordResponse = z.infer<typeof namedRecordResponseSchema>;

// ---- Sites ----
export const upsertSiteLevelRequestSchema = z.object({ name: nameSchema });
export type UpsertSiteLevelRequest = z.infer<typeof upsertSiteLevelRequestSchema>;

export const siteLevelParamSchema = z.coerce.number().int().min(1).max(20);

export const siteLevelResponseSchema = z.object({ level: z.number().int().min(1), name: z.string() });
export type SiteLevelResponse = z.infer<typeof siteLevelResponseSchema>;

export const createSiteRequestSchema = z.object({
  name: nameSchema,
  parentId: uuidSchema.optional(),
  isCentral: z.boolean().optional(),
});
export type CreateSiteRequest = z.infer<typeof createSiteRequestSchema>;

export const updateSiteRequestSchema = z
  .object({ name: nameSchema, isCentral: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateSiteRequest = z.infer<typeof updateSiteRequestSchema>;

/** `parentId: null` moves the site to the root. */
export const moveSiteRequestSchema = z.object({ parentId: uuidSchema.nullable() });
export type MoveSiteRequest = z.infer<typeof moveSiteRequestSchema>;

export const siteResponseSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  level: z.number().int().min(1),
  name: z.string(),
  isCentral: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type SiteResponse = z.infer<typeof siteResponseSchema>;

export interface SiteTreeNode extends SiteResponse {
  readonly children: readonly SiteTreeNode[];
}

// ---- Calendars ----
export const createCalendarRequestSchema = z.object({
  name: nameSchema,
  countryCode: countryCodeSchema.optional(),
});
export type CreateCalendarRequest = z.infer<typeof createCalendarRequestSchema>;

export const updateCalendarRequestSchema = z
  .object({ name: nameSchema, countryCode: countryCodeSchema.nullable() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateCalendarRequest = z.infer<typeof updateCalendarRequestSchema>;

export const workingSlotSchema = z
  .object({ startTime: timeOfDaySchema, endTime: timeOfDaySchema })
  .refine((slot) => slot.startTime < slot.endTime, 'The slot must end after it starts (split night shifts in two)');
export type WorkingSlotRequest = z.infer<typeof workingSlotSchema>;

/** Replaces every slot of one weekday (0 = Sunday … 6 = Saturday); an empty list makes it a non-working day. */
export const replaceWorkingDayRequestSchema = z.object({ slots: z.array(workingSlotSchema).max(10) });
export type ReplaceWorkingDayRequest = z.infer<typeof replaceWorkingDayRequestSchema>;

export const weekdayParamSchema = z.coerce.number().int().min(0).max(6);

export const workingHoursResponseSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
});
export type WorkingHoursResponse = z.infer<typeof workingHoursResponseSchema>;

export const calendarResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  countryCode: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export interface CalendarDetailResponse extends CalendarResponse {
  readonly workingHours: readonly WorkingHoursResponse[];
}

export const addHolidayRequestSchema = z.object({ date: isoDateSchema, name: nameSchema });
export type AddHolidayRequest = z.infer<typeof addHolidayRequestSchema>;

export const holidaysQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
export type HolidaysQuery = z.infer<typeof holidaysQuerySchema>;

export const importHolidaysRequestSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export type ImportHolidaysRequest = z.infer<typeof importHolidaysRequestSchema>;

export const holidayResponseSchema = z.object({ date: z.string(), name: z.string() });
export type HolidayResponse = z.infer<typeof holidayResponseSchema>;

export const importHolidaysResponseSchema = z.object({ imported: z.number().int().min(0) });
export type ImportHolidaysResponse = z.infer<typeof importHolidaysResponseSchema>;

/** Preview of an SLA deadline on a calendar (also used by the UI while configuring SLAs). */
export const previewDueDateRequestSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  amount: z.number().positive().max(10_000),
  unit: z.enum(['BUSINESS_HOURS', 'BUSINESS_DAYS']),
  /** Defaults to the time zone of the calendar's country, then of the tenant. */
  timeZone: timeZoneSchema.optional(),
});
export type PreviewDueDateRequest = z.infer<typeof previewDueDateRequestSchema>;

export const previewDueDateResponseSchema = z.object({
  dueDate: z.string(),
  businessMinutes: z.number().int().min(0),
  timeZone: z.string(),
});
export type PreviewDueDateResponse = z.infer<typeof previewDueDateResponseSchema>;
