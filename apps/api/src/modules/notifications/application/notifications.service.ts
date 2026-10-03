import { Inject, Injectable } from '@nestjs/common';
import {
  type ListNotificationsQuery,
  type MarkedReadResponse,
  NOTIFICATION_TYPES,
  NotFoundError,
  type NotificationPreferenceRequest,
  type NotificationPreferenceResponse,
  type NotificationResponse,
  type NotificationTypeValue,
  type Page,
  type UnreadCountResponse,
} from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { NotificationRepository } from '../data/notification.repository.js';
import { DEFAULT_CHANNELS } from '../domain/channels.js';

/** A person's own notifications and preferences: every call is scoped to the caller, in the query and by row-level security. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TenantContext) private readonly context: TenantContext,
  ) {}

  list(who: Principal, query: ListNotificationsQuery): Promise<Page<NotificationResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { items, total } = await this.notifications.list(tx, who.tenantId, who.userId, { unread: query.unread, ...pageWindow(query) });
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async unreadCount(who: Principal): Promise<UnreadCountResponse> {
    return { count: await this.runner.withTenantTransaction((tx) => this.notifications.unreadCount(tx, who.tenantId, who.userId)) };
  }

  /** The same counter for a person outside a request (real time): read as that person, so only their own rows count. */
  unreadCountOf(tenantId: string, userId: string): Promise<number> {
    return this.context.run({ tenantId, userId }, () => this.runner.withTenantTransaction((tx) => this.notifications.unreadCount(tx, tenantId, userId)));
  }

  /** Idempotent: reading it again keeps the first reading time. Someone else's notification is a missing one. */
  markRead(who: Principal, id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.notifications.exists(tx, who.tenantId, who.userId, id))) throw new NotFoundError();
      await this.notifications.markRead(tx, who.tenantId, who.userId, this.clock.now(), id);
    });
  }

  markAllRead(who: Principal): Promise<MarkedReadResponse> {
    return this.runner.withTenantTransaction(async (tx) => ({ updated: await this.notifications.markRead(tx, who.tenantId, who.userId, this.clock.now()) }));
  }

  /** Every type, with the defaults where the person never chose. */
  preferences(who: Principal): Promise<NotificationPreferenceResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const stored = new Map((await this.notifications.preferences(tx, who.tenantId, who.userId)).map((preference) => [preference.type, preference]));
      return NOTIFICATION_TYPES.map((type) => stored.get(type) ?? { type, ...DEFAULT_CHANNELS });
    });
  }

  async savePreference(who: Principal, type: NotificationTypeValue, request: NotificationPreferenceRequest): Promise<NotificationPreferenceResponse> {
    await this.runner.withTenantTransaction((tx) => this.notifications.savePreference(tx, who.tenantId, who.userId, type, request));
    return { type, ...request };
  }
}
