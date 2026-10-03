import { z } from 'zod';
import { emailSchema } from '../common.js';
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
