import { z } from 'zod';
import { emailSchema } from '../common.js';
import { uuidSchema } from '../ids.js';
import { newPasswordSchema, PASSWORD_MAX_LENGTH } from './password.js';

/** Opaque one-time tokens (invitation, password reset): long random strings. */
const oneTimeTokenSchema = z.string().min(20).max(256);

export const membershipStatusSchema = z.enum(['INVITED', 'ACTIVE']);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const organizationSchema = z.object({
  tenantId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  membershipStatus: membershipStatusSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

export const loginResponseSchema = z.object({
  organizations: z.array(organizationSchema),
  /** Short-lived token that only works to pick an organization (`POST /auth/select-tenant`). */
  selectionToken: z.string(),
  expiresIn: z.number().int().positive(),
  /** The user may also open a platform session (`POST /auth/platform/select`). Only they are told. */
  platformAdmin: z.boolean(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const selectTenantRequestSchema = z.object({ tenantId: uuidSchema });
export type SelectTenantRequest = z.infer<typeof selectTenantRequestSchema>;

/** Answer of `select-tenant` and `refresh`; the refresh token travels in an httpOnly cookie. */
export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: oneTimeTokenSchema,
  newPassword: newPasswordSchema,
});
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>;

/**
 * A new user must send a password; a user who already has one must not (an invitation never changes
 * an existing password: the database rejects it).
 */
export const acceptInvitationRequestSchema = z.object({
  token: oneTimeTokenSchema,
  password: newPasswordSchema.optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const acceptInvitationResponseSchema = z.object({ tenantId: uuidSchema });
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: uuidSchema,
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    locale: z.string(),
    timeZone: z.string().nullable(),
    mfaEnabled: z.boolean(),
    emailVerifiedAt: z.iso.datetime().nullable(),
  }),
  membership: z.object({
    tenantId: uuidSchema,
    status: z.literal('ACTIVE'),
    isOwner: z.boolean(),
    role: z.object({ id: uuidSchema, name: z.string(), isAdmin: z.boolean() }),
    companies: z.array(z.object({ id: uuidSchema, name: z.string(), isDefault: z.boolean() })),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Claims of the access token. */
export const accessTokenClaimsSchema = z.object({
  /** User id. */
  sub: uuidSchema,
  /** Tenant id. */
  tid: uuidSchema,
  /** Session id (row of `refresh_sessions`). */
  sid: uuidSchema,
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** Claims of the platform access token: no tenant. */
export const platformTokenClaimsSchema = z.object({
  /** User id. */
  sub: uuidSchema,
  /** Session id (row of `refresh_sessions` with no active tenant). */
  sid: uuidSchema,
});
export type PlatformTokenClaims = z.infer<typeof platformTokenClaimsSchema>;
