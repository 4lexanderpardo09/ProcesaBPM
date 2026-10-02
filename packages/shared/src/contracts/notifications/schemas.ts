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
  readonly email: boolean;
}
