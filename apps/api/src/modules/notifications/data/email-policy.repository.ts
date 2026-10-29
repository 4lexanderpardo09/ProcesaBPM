import { Injectable } from '@nestjs/common';
import type { NotificationEmailPolicyValue, NotificationTypeValue } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { EmailPolicies } from '../domain/channels.js';

/** The organization's e-mail policy per notification type (§8.35); a type without a row keeps its built-in default. */
@Injectable()
export class EmailPolicyRepository {
  async policies(tx: TenantTransaction, tenantId: string): Promise<EmailPolicies> {
    const rows = await tx.notificationEmailPolicySetting.findMany({ where: { tenantId }, select: { type: true, policy: true } });
    return new Map(rows.map((row) => [row.type, row.policy]));
  }

  async save(tx: TenantTransaction, tenantId: string, type: NotificationTypeValue, policy: NotificationEmailPolicyValue): Promise<void> {
    await tx.notificationEmailPolicySetting.upsert({ where: { tenantId_type: { tenantId, type } }, create: { tenantId, type, policy }, update: { policy } });
  }
}
