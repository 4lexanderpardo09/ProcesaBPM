import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_POLICY_TYPES, type EmailPolicyTypeValue, type NotificationEmailPolicyResponse, type UpdateNotificationEmailPolicy } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { EmailPolicyRepository } from '../data/email-policy.repository.js';
import { builtInEmailPolicy } from '../domain/channels.js';

/** The administrator's say over which notifications go out by e-mail, type by type, for the whole organization. */
@Injectable()
export class EmailPoliciesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(EmailPolicyRepository) private readonly policies: EmailPolicyRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(principal: Principal): Promise<NotificationEmailPolicyResponse[]> {
    return this.runner.withTenantTransaction((tx) => this.read(tx, principal.tenantId));
  }

  /** The e-mails already queued follow the new policy too: the worker reads it again before sending. */
  update(principal: Principal, type: EmailPolicyTypeValue, request: UpdateNotificationEmailPolicy): Promise<NotificationEmailPolicyResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = (await this.policies.policies(tx, principal.tenantId)).get(type) ?? builtInEmailPolicy(type);
      await this.policies.save(tx, principal.tenantId, type, request.policy);
      await this.audit.record(tx, { action: 'tenant.notification_email_policy_updated', subjectType: 'Setting', subjectId: principal.tenantId, before: { type, policy: before }, after: { type, policy: request.policy } });
      return { type, policy: request.policy, chosen: true };
    });
  }

  private async read(tx: TenantTransaction, tenantId: string): Promise<NotificationEmailPolicyResponse[]> {
    const chosen = await this.policies.policies(tx, tenantId);
    return EMAIL_POLICY_TYPES.map((type) => ({ type, policy: chosen.get(type) ?? builtInEmailPolicy(type), chosen: chosen.has(type) }));
  }
}
