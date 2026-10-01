import { z } from 'zod';
import { newPasswordSchema, PASSWORD_MAX_LENGTH } from './password.js';

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** Opaque one-time tokens (invitation, password reset): long random strings. */
const oneTimeTokenSchema = z.string().min(20).max(256);

export const membershipStatusSchema = z.enum(['INVITED', 'ACTIVE']);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const organizationSchema = z.object({
  tenantId: z.uuid(),
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
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const selectTenantRequestSchema = z.object({ tenantId: z.uuid() });
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

/** The password is optional because an existing user keeps theirs; a new user must send one. */
export const acceptInvitationRequestSchema = z.object({
  token: oneTimeTokenSchema,
  password: newPasswordSchema.optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const acceptInvitationResponseSchema = z.object({ tenantId: z.uuid() });
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    locale: z.string(),
    timeZone: z.string().nullable(),
    mfaEnabled: z.boolean(),
    emailVerifiedAt: z.iso.datetime().nullable(),
  }),
  membership: z.object({
    tenantId: z.uuid(),
    status: z.literal('ACTIVE'),
    isOwner: z.boolean(),
    role: z.object({ id: z.uuid(), name: z.string(), isAdmin: z.boolean() }),
    companies: z.array(z.object({ id: z.uuid(), name: z.string(), isDefault: z.boolean() })),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Claims of the access token. */
export const accessTokenClaimsSchema = z.object({
  /** User id. */
  sub: z.uuid(),
  /** Tenant id. */
  tid: z.uuid(),
  /** Session id (row of `refresh_sessions`). */
  sid: z.uuid(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
