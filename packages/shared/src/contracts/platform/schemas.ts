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

const tenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED', 'DELETED', 'PENDING_DELETION', 'PURGED']);
const reasonSchema = z.string().trim().min(3).max(500);
/** Byte counts travel as decimal strings: they can exceed what a JSON number holds exactly. */
const bytesSchema = z.string().regex(/^\d{1,18}$/, 'Use a whole number of bytes');

export const listTenantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
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
  /** Set while the deletion is pending (and on the tombstone). */
  readonly deletion: { readonly requestedAt: string; readonly purgeAfter: string | null; readonly purgedAt: string | null } | null;
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

export const listFailedEventsQuerySchema = z.object({
  scope: z.enum(['PLATFORM', 'TENANT']),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListFailedEventsQuery = z.infer<typeof listFailedEventsQuerySchema>;

/** Never carries the payload: it can hold ids and personal data. */
export interface FailedOutboxEvent {
  readonly scope: 'PLATFORM' | 'TENANT';
  readonly tenantId: string | null;
  readonly id: string;
  readonly type: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
}

export interface PlatformMetrics {
  readonly tenantsByStatus: Readonly<Record<string, number>>;
  readonly users: { readonly total: number; readonly withActiveMembership: number };
  readonly storageUsedBytes: string;
  readonly ticketsPerDay: ReadonlyArray<{ readonly date: string; readonly count: number }>;
}

export const listPlatformAuditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    actorUserId: uuidSchema.optional(),
    tenantId: uuidSchema.optional(),
    action: z.string().trim().min(1).max(64).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => value.from === undefined || value.to === undefined || new Date(value.to) > new Date(value.from), { path: ['to'], message: 'The end must be after the start' });
export type ListPlatformAuditQuery = z.infer<typeof listPlatformAuditQuerySchema>;

export interface PlatformAuditEntryResponse {
  readonly id: string;
  /** `null` only for the system's retention runs (`retention.run_started`, `retention.run_finished`). */
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetTenantId: string | null;
  readonly data: unknown;
  readonly ipAddress: string | null;
  readonly createdAt: string;
}

export const requestTenantDeletionSchema = z.object({
  /** The name of the organization, typed again: deleting is not something to do by accident. */
  confirmName: z.string().trim().min(1).max(200),
  reason: reasonSchema,
});
export type RequestTenantDeletion = z.infer<typeof requestTenantDeletionSchema>;

export interface TenantDeletionResponse {
  readonly tenantId: string;
  readonly status: 'PENDING_DELETION' | 'SUSPENDED';
  /** When the purge becomes possible; empty after the deletion was cancelled. */
  readonly purgeAfter: string | null;
}

/** Exact e-mail only: no search and no prefix, so the lookup cannot be used to list accounts. */
export const platformUserLookupQuerySchema = z.object({ email: emailSchema }).strict();
export type PlatformUserLookupQuery = z.infer<typeof platformUserLookupQuerySchema>;

export interface PlatformUserMembership {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly status: 'INVITED' | 'ACTIVE' | 'INACTIVE';
  readonly isOwner: boolean;
}

/** What support sees of an account before resetting its second factor; never a secret. */
export interface PlatformUserResponse {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
  readonly mfaEnabled: boolean;
  readonly isPlatformAdmin: boolean;
  readonly memberships: readonly PlatformUserMembership[];
}

/** How support verified who asked for the reset (recorded, not automated). */
export const MFA_RESET_VERIFICATION_METHODS = ['VIDEO_CALL', 'CALLBACK_KNOWN_NUMBER', 'TENANT_ADMIN_REQUEST', 'IN_PERSON'] as const;
export type MfaResetVerificationMethod = (typeof MFA_RESET_VERIFICATION_METHODS)[number];

export const mfaResetRequestSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
    verification: z
      .object({
        method: z.enum(MFA_RESET_VERIFICATION_METHODS),
        /** A ticket or case id; never a document number. */
        reference: z.string().trim().min(3).max(200),
        /** The organization administrator who asked: required for, and only for, `TENANT_ADMIN_REQUEST`. */
        tenantAdminUserId: uuidSchema.optional(),
      })
      .strict()
      .refine((value) => (value.method === 'TENANT_ADMIN_REQUEST') === (value.tenantAdminUserId !== undefined), {
        path: ['tenantAdminUserId'],
        message: 'Give the requesting administrator for, and only for, a tenant administrator request',
      }),
  })
  .strict();
export type MfaResetRequest = z.infer<typeof mfaResetRequestSchema>;

export interface MfaResetResponse {
  readonly resetAt: string;
  readonly revokedSessions: number;
}
