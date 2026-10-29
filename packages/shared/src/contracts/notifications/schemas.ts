import { z } from 'zod';
import { pageQuerySchema } from '../common.js';

export const NOTIFICATION_TYPES = [
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_TRANSITIONED',
  'TICKET_COMMENTED',
  'TICKET_CLOSED',
  'TICKET_REOPENED',
  'INCIDENT_OPENED',
  'INCIDENT_RESOLVED',
  'SLA_WARNING',
  'SLA_OVERDUE',
  'OBSERVER_UPDATE',
  'STORAGE_QUOTA',
  'SYSTEM',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationTypeValue = z.infer<typeof notificationTypeSchema>;

export const listNotificationsQuerySchema = pageQuerySchema.pick({ page: true, pageSize: true }).extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationPreferenceRequestSchema = z.object({ inApp: z.boolean(), email: z.boolean() }).strict();
export type NotificationPreferenceRequest = z.infer<typeof notificationPreferenceRequestSchema>;

export interface NotificationResponse {
  readonly id: string;
  readonly type: NotificationTypeValue;
  readonly title: string;
  readonly body: string;
  readonly ticketId: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface UnreadCountResponse {
  readonly count: number;
}

export interface MarkedReadResponse {
  readonly updated: number;
}

export interface NotificationPreferenceResponse {
  readonly type: NotificationTypeValue;
  readonly inApp: boolean;
  /** Whether it arrives by e-mail: always `false` while the organization turned this type's e-mail off. */
  readonly email: boolean;
  /** The organization turned this type's e-mail off: the person cannot turn it on. */
  readonly emailLocked: boolean;
}

/**
 * What the organization lets a type do by e-mail: never (`OFF`), only to whoever turns it on (`DEFAULT_OFF`) or to
 * everyone who does not turn it off (`DEFAULT_ON`).
 */
export const NOTIFICATION_EMAIL_POLICIES = ['OFF', 'DEFAULT_OFF', 'DEFAULT_ON'] as const;
export const notificationEmailPolicySchema = z.enum(NOTIFICATION_EMAIL_POLICIES);
export type NotificationEmailPolicyValue = z.infer<typeof notificationEmailPolicySchema>;

/** The types an administrator governs: the storage warning is the administrators' own alert, not a ticket e-mail. */
export const EMAIL_POLICY_TYPES = NOTIFICATION_TYPES.filter((type): type is Exclude<NotificationTypeValue, 'STORAGE_QUOTA'> => type !== 'STORAGE_QUOTA');
export const emailPolicyTypeSchema = z.enum(EMAIL_POLICY_TYPES as [Exclude<NotificationTypeValue, 'STORAGE_QUOTA'>, ...Exclude<NotificationTypeValue, 'STORAGE_QUOTA'>[]]);
export type EmailPolicyTypeValue = z.infer<typeof emailPolicyTypeSchema>;

export const updateNotificationEmailPolicySchema = z.object({ policy: notificationEmailPolicySchema }).strict();
export type UpdateNotificationEmailPolicy = z.infer<typeof updateNotificationEmailPolicySchema>;

export const notificationEmailPolicyResponseSchema = z.object({
  type: emailPolicyTypeSchema,
  policy: notificationEmailPolicySchema,
  /** `false` while the organization never chose: `policy` is then the type's built-in default. */
  chosen: z.boolean(),
});
export type NotificationEmailPolicyResponse = z.infer<typeof notificationEmailPolicyResponseSchema>;
