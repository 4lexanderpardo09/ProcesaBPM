import { z } from 'zod';
import { emailSchema, nameSchema } from '../common.js';
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

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const organizationSchema = z.object({
  tenantId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  membershipStatus: membershipStatusSchema,
  /** The organization requires two-step verification from its members. */
  mfaRequired: z.boolean(),
  /** A platform announcement blocks entering it right now: selecting it answers 503 `MAINTENANCE`. */
  maintenance: z.object({ title: z.string(), endsAt: z.string().nullable() }).nullable(),
});
export type Organization = z.infer<typeof organizationSchema>;

const selectOrganizationFields = {
  organizations: z.array(organizationSchema),
  /** Short-lived, single-use token that only works to pick an organization (`POST /auth/select-tenant`). */
  selectionToken: z.string(),
  expiresIn: z.number().int().positive(),
  /** The user may also open a platform session (`POST /auth/platform/select`). Only they are told. */
  platformAdmin: z.boolean(),
};

/** The sign-in is complete: pick an organization. */
export const selectOrganizationResponseSchema = z.object({ step: z.literal('SELECT_ORGANIZATION'), ...selectOrganizationFields });
export type SelectOrganizationResponse = z.infer<typeof selectOrganizationResponseSchema>;

/** The password was right and the account has two-step verification: send the code to `POST /auth/login/mfa`. */
export const mfaRequiredResponseSchema = z.object({
  step: z.literal('MFA_REQUIRED'),
  challengeToken: z.string(),
  expiresIn: z.number().int().positive(),
  methods: z.array(z.enum(['TOTP', 'BACKUP_CODE'])),
});
export type MfaRequiredResponse = z.infer<typeof mfaRequiredResponseSchema>;

/** The account must enroll before it can continue (an organization requires it, or the user administers the platform). */
export const mfaEnrollmentRequiredResponseSchema = z.object({
  step: z.literal('MFA_ENROLLMENT_REQUIRED'),
  challengeToken: z.string(),
  expiresIn: z.number().int().positive(),
  reason: z.enum(['TENANT_POLICY', 'PLATFORM_ADMIN']),
});
export type MfaEnrollmentRequiredResponse = z.infer<typeof mfaEnrollmentRequiredResponseSchema>;

export const loginResponseSchema = z.discriminatedUnion('step', [
  selectOrganizationResponseSchema,
  mfaRequiredResponseSchema,
  mfaEnrollmentRequiredResponseSchema,
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

const totpCodeSchema = z.string().regex(/^\d{6}$/, 'must be 6 digits');
const backupCodeSchema = z.string().min(16).max(24);

export const mfaCodeSchema = z.object({ code: totpCodeSchema });

/** Enrolling from a signed-in session also needs the password: a stolen access token alone cannot take over the account's second factor. */
export const mfaEnrollmentConfirmRequestSchema = z.object({ code: totpCodeSchema, currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
export type MfaEnrollmentConfirmRequest = z.infer<typeof mfaEnrollmentConfirmRequestSchema>;
export type MfaCode = z.infer<typeof mfaCodeSchema>;

/** Exactly one of the two: the code of the authenticator app, or one of the backup codes. */
export const mfaFactorSchema = z.union([
  z.object({ code: totpCodeSchema }).strict(),
  z.object({ backupCode: backupCodeSchema }).strict(),
]);
export type MfaFactor = z.infer<typeof mfaFactorSchema>;

/** Answer of `POST /auth/login/mfa`: the sign-in is complete, plus how many backup codes are left when one was used. */
export const mfaLoginResponseSchema = selectOrganizationResponseSchema.extend({ backupCodesLeft: z.number().int().min(0).optional() });
export type MfaLoginResponse = z.infer<typeof mfaLoginResponseSchema>;

export const mfaEnrollmentSchema = z.object({
  /** Base32 secret, for typing it by hand. */
  secret: z.string(),
  /** `otpauth://totp/…`: the web client draws it as a QR code. */
  otpauthUri: z.string(),
  issuer: z.string(),
  accountName: z.string(),
  algorithm: z.literal('SHA1'),
  digits: z.literal(6),
  period: z.literal(30),
});
export type MfaEnrollment = z.infer<typeof mfaEnrollmentSchema>;

/** Shown once: the user must save them. */
export const backupCodesResponseSchema = z.object({ backupCodes: z.array(z.string()).length(10) });
export type BackupCodesResponse = z.infer<typeof backupCodesResponseSchema>;

/** Answer of the login-time enrollment confirmation: the backup codes plus the completed sign-in. */
export const mfaEnrollmentConfirmedResponseSchema = mfaLoginResponseSchema.extend({ backupCodes: z.array(z.string()).length(10) });
export type MfaEnrollmentConfirmedResponse = z.infer<typeof mfaEnrollmentConfirmedResponseSchema>;

export const mfaStatusResponseSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().nullable(),
  backupCodesLeft: z.number().int().min(0),
  /** An organization requires it (or the user administers the platform): it cannot be turned off. */
  requiredByPolicy: z.boolean(),
});
export type MfaStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const disableMfaRequestSchema = z.union([
  z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH), code: totpCodeSchema }).strict(),
  z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH), backupCode: backupCodeSchema }).strict(),
]);
export type DisableMfaRequest = z.infer<typeof disableMfaRequestSchema>;

export const tenantSecuritySettingsSchema = z.object({ mfaRequired: z.boolean() });
export type TenantSecuritySettings = z.infer<typeof tenantSecuritySettingsSchema>;

export const tenantSecuritySettingsResponseSchema = tenantSecuritySettingsSchema.extend({ activeMembersWithoutMfa: z.number().int().min(0) });
export type TenantSecuritySettingsResponse = z.infer<typeof tenantSecuritySettingsResponseSchema>;

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
    /** The member's handwritten signature for the PDFs, if they uploaded one. */
    signatureFileId: uuidSchema.nullable(),
  }),
  /** `DELETION_PENDING`: the organization is pending deletion; the session only serves the profile and the data export. */
  tenantMode: z.enum(['ACTIVE', 'DELETION_PENDING']),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** The user edits their own profile: their name, language and time zone (the e-mail has its own flow). */
export const updateProfileRequestSchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Use xx-XX').optional(),
    timeZone: z.string().min(1).max(64).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/** The signature is an image already uploaded and confirmed (the two-phase upload): the request points at it. */
export const setSignatureRequestSchema = z.object({ fileId: uuidSchema });
export type SetSignatureRequest = z.infer<typeof setSignatureRequestSchema>;

export const signatureResponseSchema = z.object({ url: z.string(), expiresAt: z.iso.datetime() });
export type SignatureResponse = z.infer<typeof signatureResponseSchema>;

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
