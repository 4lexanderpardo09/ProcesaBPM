import { Inject, Injectable } from '@nestjs/common';
import { CompanyRequiredError, findEngineSupportProblems, InvalidReferenceError, NotImplementedError, type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type CompanyRow, type MemberRow, TicketContextRepository } from '../data/ticket-context.repository.js';
import { isAllowedInitiator } from '../domain/initiator-match.js';

/**
 * Who may start a ticket where: the requester's company and the START blocks that admit them. Creating a ticket and
 * showing its creation form ask the same questions, so a form never offers a start the creation would then refuse.
 */
@Injectable()
export class CreationGate {
  constructor(@Inject(TicketContextRepository) private readonly people: TicketContextRepository) {}

  /** One of the requester's companies: the chosen one, or their only one. */
  async companyOf(tx: TenantTransaction, tenantId: string, requester: MemberRow, chosenId: string | undefined): Promise<CompanyRow> {
    if (chosenId === undefined && requester.companyIds.length > 1) throw new CompanyRequiredError();
    const companyId = chosenId ?? requester.companyIds[0];
    if (companyId === undefined || !requester.companyIds.includes(companyId)) throw new InvalidReferenceError("The company is not one of the requester's companies");
    const company = await this.people.findCompany(tx, tenantId, companyId);
    if (company === null) throw new InvalidReferenceError('The company is not active');
    return company;
  }

  /** The START blocks whose initiators admit the requester (a block without initiators admits everyone). */
  async allowedStarts(tx: TenantTransaction, tenantId: string, starts: readonly StepDocument[], requester: MemberRow, company: CompanyRow): Promise<StepDocument[]> {
    if (starts.every((start) => start.initiators.length === 0)) return [...starts];
    return (await this.startFilterFor(tx, tenantId, requester))(starts, company.id);
  }

  /**
   * A filter of START blocks for one requester and any of their companies, reading their groups and sites once: the
   * catalog asks it for every subcategory it lists.
   */
  async startFilterFor(tx: TenantTransaction, tenantId: string, requester: MemberRow): Promise<(starts: readonly StepDocument[], companyId: string) => StepDocument[]> {
    const groupIds = await this.people.activeGroupIdsOf(tx, tenantId, requester.userId);
    const siteAncestry = new Set(requester.siteId === null ? [] : await this.people.siteAncestry(tx, tenantId, requester.siteId));
    return (starts, companyId) =>
      starts.filter(
        (start) =>
          start.initiators.length === 0 ||
          isAllowedInitiator(start.initiators, { userId: requester.userId, positionId: requester.positionId, departmentId: requester.departmentId, siteId: requester.siteId, companyId, groupIds, siteAncestry }),
      );
  }

  /** The requester as the engine sees them, or `null` when they are not an active member. */
  requesterOf(tx: TenantTransaction, tenantId: string, userId: string): Promise<MemberRow | null> {
    return this.people.findActiveMember(tx, tenantId, userId);
  }
}

/** A version with blocks the engine cannot run yet (published before it learned to refuse them) is not started. */
export function assertRunnable(document: WorkflowVersionDocument): void {
  const problem = findEngineSupportProblems(document).find((candidate) => candidate.severity === 'error');
  if (problem !== undefined) throw new NotImplementedError(problem.code);
}
