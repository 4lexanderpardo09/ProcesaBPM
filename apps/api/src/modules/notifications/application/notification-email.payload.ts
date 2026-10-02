import { notificationTypeSchema, uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';

/** Ids only: the e-mail handler reads names, titles and addresses when it sends, after checking the reader again. */
export const notificationEmailPayloadSchema = z
  .object({ userId: uuidSchema, notificationType: notificationTypeSchema, ticketId: uuidSchema, sourceEventId: uuidSchema })
  .strict();
export type NotificationEmailPayload = z.infer<typeof notificationEmailPayloadSchema>;
