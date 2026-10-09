import { z } from 'zod';
import { uuidSchema } from '@procesabpm/shared';

export const PASSWORD_RESET_EVENT = 'email.password_reset';
export const INVITATION_EVENT = 'email.invitation';
export const PLATFORM_ADMIN_INVITATION_EVENT = 'email.platform_admin_invitation';
export const TENANT_DELETION_REQUESTED_EVENT = 'email.tenant_deletion_requested';
/** Queued only by `enqueue_due_purge_reminders` (B17), together with the level it records on the tenant. */
export const TENANT_PURGE_REMINDER_EVENT = 'email.tenant_purge_reminder';
/** Queued only through `enqueue_security_notice` (the database refuses it in `enqueue_platform_event`). */
export const SECURITY_NOTICE_EVENT = 'email.security_notice';

/** Queued only by `finish_tenant_export`, in the transaction that marks the export READY (§8.31). */
export const DATA_EXPORT_READY_EVENT = 'email.data_export_ready';

/** The same list as `enqueue_security_notice`. */
export const SECURITY_NOTICE_KINDS = [
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'MFA_ENABLED',
  'MFA_DISABLED',
  'MFA_BACKUP_CODES_REGENERATED',
  'MFA_RESET_BY_SUPPORT',
  'ACCOUNT_LOCKED',
  'MFA_LOCKED',
  'PLATFORM_ADMIN_SIGN_IN',
] as const;
export type SecurityNoticeKind = (typeof SECURITY_NOTICE_KINDS)[number];

/** Notices to the owner of an organization about one of its members (`enqueue_member_security_notice`). */
export const MEMBER_SECURITY_NOTICE_KINDS = ['MEMBER_MFA_RESET_BY_SUPPORT'] as const;
export type MemberSecurityNoticeKind = (typeof MEMBER_SECURITY_NOTICE_KINDS)[number];

/**
 * Platform events carry only ids: the worker reads the address from `users` and issues the one-time token itself,
 * so no secret and no address chosen by a caller ever sits in the outbox. Strict on purpose: an event queued by
 * an older version (with a token in it) does not match and ends as FAILED.
 */
export const passwordResetPayloadSchema = z.object({ userId: uuidSchema }).strict();
export const platformAdminInvitationPayloadSchema = z.object({ userId: uuidSchema }).strict();
export const tenantDeletionRequestedPayloadSchema = z.object({ tenantId: uuidSchema, userId: uuidSchema }).strict();
export const tenantPurgeReminderPayloadSchema = z.object({ tenantId: uuidSchema, userId: uuidSchema, daysLeft: z.union([z.literal(7), z.literal(1)]) }).strict();
export type TenantPurgeReminderPayload = z.infer<typeof tenantPurgeReminderPayloadSchema>;
export const invitationPayloadSchema = z.object({ tenantId: uuidSchema, userId: uuidSchema }).strict();
export const dataExportReadyPayloadSchema = z.object({ tenantId: uuidSchema, exportId: uuidSchema, userId: uuidSchema }).strict();
export type DataExportReadyPayload = z.infer<typeof dataExportReadyPayloadSchema>;
const personalSecurityNoticePayloadSchema = z.object({ userId: uuidSchema, kind: z.enum(SECURITY_NOTICE_KINDS), sessionId: uuidSchema.optional() }).strict();
/** `userId` is the owner who gets the mail; `memberId` the member of `tenantId` it is about. */
const memberSecurityNoticePayloadSchema = z.object({ userId: uuidSchema, kind: z.enum(MEMBER_SECURITY_NOTICE_KINDS), tenantId: uuidSchema, memberId: uuidSchema }).strict();
export const securityNoticePayloadSchema = z.discriminatedUnion('kind', [personalSecurityNoticePayloadSchema, memberSecurityNoticePayloadSchema]);
export type PersonalSecurityNoticePayload = z.infer<typeof personalSecurityNoticePayloadSchema>;
export type MemberSecurityNoticePayload = z.infer<typeof memberSecurityNoticePayloadSchema>;
export type SecurityNoticePayload = z.infer<typeof securityNoticePayloadSchema>;

export interface PlatformEventPayloads {
  readonly [PASSWORD_RESET_EVENT]: z.infer<typeof passwordResetPayloadSchema>;
  readonly [INVITATION_EVENT]: z.infer<typeof invitationPayloadSchema>;
  readonly [PLATFORM_ADMIN_INVITATION_EVENT]: z.infer<typeof platformAdminInvitationPayloadSchema>;
  readonly [TENANT_DELETION_REQUESTED_EVENT]: z.infer<typeof tenantDeletionRequestedPayloadSchema>;
}
