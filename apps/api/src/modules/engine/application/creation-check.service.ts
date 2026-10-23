import { Inject, Injectable } from '@nestjs/common';
import { type CreationCheckResponse, findEngineSupportProblems, NotFoundError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { initiatorTarget, matchesInitiator, type Requester } from '../domain/initiator-match.js';

/**
 * "Why can (or can't) this person open a ticket of this workflow?", for whoever configures workflows: the same
 * questions as creating it (an active member, one of their companies, the subcategory shown to them, a runnable
 * published version and a START block that admits them), each answered on its own instead of stopping at the first.
 */
@Injectable()
export class CreationCheckService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
  ) {}

  check(workflowId: string, userId: string, companyId: string): Promise<CreationCheckResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const subcategoryId = await this.people.workflowSubcategory(tx, tenantId, workflowId);
      if (subcategoryId === null) throw new NotFoundError();
      const member = await this.people.findActiveMember(tx, tenantId, userId);
      const company = await this.people.findCompany(tx, tenantId, companyId);
      const published = await this.versions.findForSubcategory(tx, tenantId, subcategoryId);
      const runnable = published !== null && published.workflowId === workflowId && !findEngineSupportProblems(published.document).some((problem) => problem.severity === 'error');
      const companyAllowed = member !== null && company !== null && member.companyIds.includes(companyId);
      const subcategoryVisible = member !== null && (await this.people.findAvailableSubcategory(tx, tenantId, subcategoryId, companyId, member.departmentId)) !== null;
      if (member === null || published === null || published.workflowId !== workflowId) {
        return { canCreate: false, activeMember: member !== null, companyAllowed, subcategoryVisible, published: runnable, starts: [] };
      }
      const requester: Requester = {
        userId,
        positionId: member.positionId,
        departmentId: member.departmentId,
        siteId: member.siteId,
        companyId,
        groupIds: await this.people.activeGroupIdsOf(tx, tenantId, userId),
        siteAncestry: new Set(member.siteId === null ? [] : await this.people.siteAncestry(tx, tenantId, member.siteId)),
      };
      const starts = published.document.steps
        .filter((step) => step.type === 'START')
        .map((start) => {
          const rules = start.initiators.map((initiator) => ({ kind: initiator.participantType, targetId: initiatorTarget(initiator), matches: matchesInitiator(initiator, requester) }));
          return { stepId: start.id, name: start.name, allowed: rules.length === 0 || rules.some((rule) => rule.matches), rules };
        });
      const canCreate = companyAllowed && subcategoryVisible && runnable && starts.some((start) => start.allowed);
      return { canCreate, activeMember: true, companyAllowed, subcategoryVisible, published: runnable, starts };
    });
  }
}
