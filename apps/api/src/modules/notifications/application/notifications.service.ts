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
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { EmailPolicyRepository } from '../data/email-policy.repository.js';
import { NotificationRepository } from '../data/notification.repository.js';
import { channelsFor, type EmailPolicies, emailLocked } from '../domain/channels.js';

/** A person's own notifications and preferences: every call is scoped to the caller, in the query and by row-level security. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(EmailPolicyRepository) private readonly emailPolicies: EmailPolicyRepository,
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

  /** Every type as it actually arrives: the person's choice, else the organization's default, never e-mail where the organization turned it off. */
  preferences(who: Principal): Promise<NotificationPreferenceResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const stored = await this.storedOf(tx, who);
      const policies = await this.emailPolicies.policies(tx, who.tenantId);
      return NOTIFICATION_TYPES.map((type) => effective(stored, who.userId, type, policies));
    });
  }

  /** The choice is kept as made (it counts again if the organization turns the e-mail back on); the answer is what arrives now. */
  savePreference(who: Principal, type: NotificationTypeValue, request: NotificationPreferenceRequest): Promise<NotificationPreferenceResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.notifications.savePreference(tx, who.tenantId, who.userId, type, request);
      return effective(new Map([[`${who.userId}:${type}`, request]]), who.userId, type, await this.emailPolicies.policies(tx, who.tenantId));
    });
  }

  private async storedOf(tx: TenantTransaction, who: Principal): Promise<Map<string, { inApp: boolean; email: boolean }>> {
    const rows = await this.notifications.preferences(tx, who.tenantId, who.userId);
    return new Map(rows.map((row) => [`${who.userId}:${row.type}`, { inApp: row.inApp, email: row.email }]));
  }
}

function effective(stored: ReadonlyMap<string, { inApp: boolean; email: boolean }>, userId: string, type: NotificationTypeValue, policies: EmailPolicies): NotificationPreferenceResponse {
  return { type, ...channelsFor(stored, userId, type, policies), emailLocked: emailLocked(type, policies) };
}
