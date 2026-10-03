import { Inject, Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SUBJECT_REGISTRY } from '../../authorization/application/ability.service.js';
import { RolePermissionRepository } from '../../authorization/data/role-permission.repository.js';
import { buildAbility, type RawPermissionRule } from '../../authorization/domain/build-ability.js';
import { fixedRules } from '../../authorization/domain/full-access.js';
import { SubjectRegistry } from '../../authorization/domain/subject-registry.js';
import { readableTickets } from '../../tickets/application/ticket-access.js';
import { TicketQueryRepository } from '../../tickets/data/ticket-query.repository.js';
import { RecipientRepository } from '../data/recipient.repository.js';

/**
 * Keeps, from the people who could be told about a ticket, only those who may read it right now: active members of
 * active accounts whose permissions (checked by the database, like for any request) let them see THIS ticket. Nobody
 * is told about a ticket they cannot open, whatever the reason they were picked. Fails closed.
 */
@Injectable()
export class TicketReaderFilter {
  constructor(
    @Inject(RecipientRepository) private readonly recipients: RecipientRepository,
    @Inject(RolePermissionRepository) private readonly roles: RolePermissionRepository,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
    @Inject(SUBJECT_REGISTRY) private readonly registry: SubjectRegistry,
  ) {}

  async filter(tx: TenantTransaction, tenantId: string, ticketId: string, userIds: readonly string[]): Promise<string[]> {
    const members = await this.recipients.activeMembers(tx, tenantId, userIds);
    const rulesByRole = new Map<string, readonly RawPermissionRule[]>();
    const readers: string[] = [];
    for (const member of members) {
      const rules = fixedRules(member) ?? (await this.rulesOfRole(tx, tenantId, member.roleId, rulesByRole));
      const { ability } = buildAbility(rules, { userId: member.userId, membership: member.membership }, this.registry);
      if (await this.tickets.isAccessible(tx, tenantId, ticketId, readableTickets(ability))) readers.push(member.userId);
    }
    return readers;
  }

  private async rulesOfRole(tx: TenantTransaction, tenantId: string, roleId: string, memo: Map<string, readonly RawPermissionRule[]>): Promise<readonly RawPermissionRule[]> {
    const known = memo.get(roleId);
    if (known !== undefined) return known;
    const rules = (await this.roles.loadRules(tx, tenantId, roleId))?.rules ?? [];
    memo.set(roleId, rules);
    return rules;
  }
}
