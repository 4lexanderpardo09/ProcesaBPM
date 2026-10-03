import { z } from 'zod';
import { emailSchema, isoDateSchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/** Same pattern as the CHECK constraint `tenants_slug_format` of the database. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const personNameSchema = z.string().trim().min(1).max(100);

export const createTenantRequestSchema = z.object({
  slug: z.string().regex(TENANT_SLUG_PATTERN, 'Use lowercase letters, digits and hyphens, not at the ends (1 to 63 characters)'),
  name: z.string().trim().min(1).max(200),
  planCode: z.string().trim().min(1).max(64),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Use the two-letter country code in capitals'),
  owner: z.object({
    email: emailSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
  }),
});
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const createTenantResponseSchema = z.object({
  tenantId: uuidSchema,
  slug: z.string(),
  ownerUserId: uuidSchema,
});
export type CreateTenantResponse = z.infer<typeof createTenantResponseSchema>;

export const tenantStatusResponseSchema = z.object({
  tenantId: uuidSchema,
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
export type TenantStatusResponse = z.infer<typeof tenantStatusResponseSchema>;

export const invitePlatformAdminRequestSchema = z.object({
  email: emailSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
});
export type InvitePlatformAdminRequest = z.infer<typeof invitePlatformAdminRequestSchema>;

export const platformAdminSummarySchema = z.object({
  userId: uuidSchema,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PlatformAdminSummary = z.infer<typeof platformAdminSummarySchema>;

const tenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'DELETED']);
const reasonSchema = z.string().trim().min(3).max(500);
/** Byte counts travel as decimal strings: they can exceed what a JSON number holds exactly. */
const bytesSchema = z.string().regex(/^\d{1,18}$/, 'Use a whole number of bytes');

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
  status: tenantStatusSchema.optional(),
  planCode: z.string().trim().min(1).max(64).optional(),
});
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;

export interface TenantListItem {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly status: z.infer<typeof tenantStatusSchema>;
  readonly planCode: string;
  readonly countryCode: string;
  readonly createdAt: string;
}

/** Aggregates only: the platform console never shows what a tenant's users wrote. */
export interface TenantDetail extends TenantListItem {
  readonly plan: { readonly code: string; readonly name: string };
  readonly owner: { readonly email: string; readonly firstName: string; readonly lastName: string; readonly membershipStatus: string } | null;
  readonly companies: number;
  readonly activeUsers: number;
  readonly storage: {
    readonly usedBytes: string;
    readonly reservedBytes: string;
    readonly extraBytes: string;
    readonly limitBytes: string;
    readonly hardLimitBytes: string;
    readonly state: 'OK' | 'OVER_LIMIT' | 'BLOCKED';
  };
  readonly ticketsLast30Days: number;
  readonly lastActivityAt: string | null;
  readonly suspension: { readonly reason: string; readonly at: string } | null;
}

export const changeTenantPlanRequestSchema = z.object({ planCode: z.string().trim().min(1).max(64) });
export type ChangeTenantPlanRequest = z.infer<typeof changeTenantPlanRequestSchema>;

export const setExtraStorageRequestSchema = z.object({ extraStorageBytes: bytesSchema });
export type SetExtraStorageRequest = z.infer<typeof setExtraStorageRequestSchema>;

export const suspendTenantRequestSchema = z.object({ reason: reasonSchema });
export type SuspendTenantRequest = z.infer<typeof suspendTenantRequestSchema>;

export const reactivateTenantRequestSchema = z.object({ reason: reasonSchema.optional() });
export type ReactivateTenantRequest = z.infer<typeof reactivateTenantRequestSchema>;

export interface PlanSummary {
  readonly code: string;
  readonly name: string;
  readonly storageBaseBytes: string;
  readonly storagePerUserBytes: string;
  readonly storageGracePercent: number;
  readonly maxUsers: number | null;
  readonly isActive: boolean;
  readonly tenants: number;
}

/** Limits only: prices live outside the platform. `maxUsers: null` removes the cap. */
export const updatePlanRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    storageBaseBytes: bytesSchema,
    storagePerUserBytes: bytesSchema,
    storageGracePercent: z.number().int().min(0).max(100),
    maxUsers: z.number().int().min(1).max(1_000_000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;

export const announcementRequestSchema = z
  .object({
    type: z.enum(['MAINTENANCE', 'RELEASE_NOTES', 'INFO']),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    blocksLogin: z.boolean().default(false),
  })
  .refine((value) => value.endsAt === null || new Date(value.endsAt) > new Date(value.startsAt), { path: ['endsAt'], message: 'The end must be after the start' });
export type AnnouncementRequest = z.infer<typeof announcementRequestSchema>;

export interface AnnouncementResponse {
  readonly id: string;
  readonly type: 'MAINTENANCE' | 'RELEASE_NOTES' | 'INFO';
  readonly title: string;
  readonly body: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly blocksLogin: boolean;
}

export const createCountryRequestSchema = z.object({
  code: z.string().regex(/^[A-Z]{2}$/, 'Use the two-letter country code in capitals'),
  name: z.string().trim().min(1).max(100),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'Use the three-letter currency code in capitals'),
  timeZone: z.string().trim().min(1).max(64),
});
export type CreateCountryRequest = z.infer<typeof createCountryRequestSchema>;

export interface CountrySummary {
  readonly code: string;
  readonly name: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly tenants: number;
  /** Whether the platform ships a rule-based holiday calendar for the country (so a year can be regenerated). */
  readonly hasHolidayGenerator: boolean;
}

export const countryHolidaysQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
export type CountryHolidaysQuery = z.infer<typeof countryHolidaysQuerySchema>;

export const addCountryHolidayRequestSchema = z.object({ date: isoDateSchema, name: z.string().trim().min(1).max(200) });
export type AddCountryHolidayRequest = z.infer<typeof addCountryHolidayRequestSchema>;

export const regenerateHolidaysRequestSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export type RegenerateHolidaysRequest = z.infer<typeof regenerateHolidaysRequestSchema>;

export interface CountryHolidayResponse {
  readonly date: string;
  readonly name: string;
}

export interface RegeneratedHolidays {
  readonly year: number;
  readonly holidays: readonly CountryHolidayResponse[];
}
