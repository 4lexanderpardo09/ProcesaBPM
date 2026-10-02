import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { NotificationEmailPayload } from '../application/notification-email.payload.js';

export const NOTIFICATION_EMAIL_EVENT = 'notification.email';

/** The e-mail of a notification is its own outbox event, so it is retried on its own and never blocks the in-app one. */
@Injectable()
export class EmailOutboxRepository {
  async enqueue(tx: TenantTransaction, tenantId: string, payloads: readonly NotificationEmailPayload[]): Promise<void> {
    if (payloads.length === 0) return;
    await tx.outboxEvent.createMany({ data: payloads.map((payload) => ({ tenantId, type: NOTIFICATION_EMAIL_EVENT, payload })) });
  }
}
