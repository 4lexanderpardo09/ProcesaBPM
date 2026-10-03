import { z } from 'zod';
import { uuidSchema } from '@procesabpm/shared';

export const PASSWORD_RESET_EVENT = 'email.password_reset';
export const INVITATION_EVENT = 'email.invitation';
export const PLATFORM_ADMIN_INVITATION_EVENT = 'email.platform_admin_invitation';

/**
 * Platform events carry only ids: the worker reads the address from `users` and issues the one-time token itself,
 * so no secret and no address chosen by a caller ever sits in the outbox. Strict on purpose: an event queued by
 * an older version (with a token in it) does not match and ends as FAILED.
 */
export const passwordResetPayloadSchema = z.object({ userId: uuidSchema }).strict();
export const platformAdminInvitationPayloadSchema = z.object({ userId: uuidSchema }).strict();
export const invitationPayloadSchema = z.object({ tenantId: uuidSchema, userId: uuidSchema }).strict();

export interface PlatformEventPayloads {
  readonly [PASSWORD_RESET_EVENT]: z.infer<typeof passwordResetPayloadSchema>;
  readonly [INVITATION_EVENT]: z.infer<typeof invitationPayloadSchema>;
  readonly [PLATFORM_ADMIN_INVITATION_EVENT]: z.infer<typeof platformAdminInvitationPayloadSchema>;
}
