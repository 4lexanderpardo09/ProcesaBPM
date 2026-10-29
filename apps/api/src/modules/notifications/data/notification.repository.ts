import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@procesabpm/db';
import type { NotificationResponse, NotificationTypeValue } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { Channels } from '../domain/channels.js';

export interface NewNotification {
  readonly userId: string;
  /** `null` for the notices about the organization itself (storage), not about a ticket. */
  readonly ticketId: string | null;
  readonly type: NotificationTypeValue;
  readonly title: string;
  readonly body: string;
  readonly sourceEventId: string;
}

const SELECT = { id: true, type: true, title: true, body: true, ticketId: true, readAt: true, createdAt: true } as const;

const toResponse = (row: { id: string; type: NotificationType; title: string; body: string; ticketId: string | null; readAt: Date | null; createdAt: Date }): NotificationResponse => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  ticketId: row.ticketId,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Every query names the tenant and the person: the row-level policy that keeps people to their own rows is the second wall. */
@Injectable()
export class NotificationRepository {
  async list(tx: TenantTransaction, tenantId: string, userId: string, filter: { unread: boolean | undefined; skip: number; take: number }): Promise<{ items: NotificationResponse[]; total: number }> {
    const where = { tenantId, userId, ...(filter.unread === undefined ? {} : { readAt: filter.unread ? null : { not: null } }) };
    const rows = await tx.notification.findMany({ where, select: SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: filter.skip, take: filter.take });
    return { items: rows.map(toResponse), total: await tx.notification.count({ where }) };
  }

  unreadCount(tx: TenantTransaction, tenantId: string, userId: string): Promise<number> {
    return tx.notification.count({ where: { tenantId, userId, readAt: null } });
  }

  async exists(tx: TenantTransaction, tenantId: string, userId: string, id: string): Promise<boolean> {
    return (await tx.notification.count({ where: { tenantId, userId, id } })) > 0;
  }

  /** Only the unread ones change, so the first reading time is kept. */
  async markRead(tx: TenantTransaction, tenantId: string, userId: string, readAt: Date, id?: string): Promise<number> {
    const { count } = await tx.notification.updateMany({ where: { tenantId, userId, readAt: null, ...(id === undefined ? {} : { id }) }, data: { readAt } });
    return count;
  }

  /** What the person chose, type by type; the types they never touched are not here. */
  preferences(tx: TenantTransaction, tenantId: string, userId: string): Promise<Array<Channels & { type: NotificationTypeValue }>> {
    return tx.notificationPreference.findMany({ where: { tenantId, userId }, select: { type: true, inApp: true, email: true } });
  }

  async savePreference(tx: TenantTransaction, tenantId: string, userId: string, type: NotificationTypeValue, channels: { inApp: boolean; email: boolean }): Promise<void> {
    await tx.notificationPreference.upsert({ where: { tenantId_userId_type: { tenantId, userId, type } }, create: { tenantId, userId, type, ...channels }, update: channels });
  }

  /** One notification per person per event: a repeated event writes nothing. */
  async createMany(tx: TenantTransaction, tenantId: string, notifications: readonly NewNotification[]): Promise<void> {
    if (notifications.length === 0) return;
    await tx.notification.createMany({ data: notifications.map((notification) => ({ tenantId, ...notification })), skipDuplicates: true });
  }
}
