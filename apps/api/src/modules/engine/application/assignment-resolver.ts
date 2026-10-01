import { Inject, Injectable } from '@nestjs/common';
import { type AssigneeCandidate, type StepDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ApproverResolver } from '../../approvals/application/approver-resolver.service.js';
import { AssignmentCandidatesRepository, type CandidateRow } from '../data/assignment-candidates.repository.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { filterBySiteScope } from '../domain/site-scope.js';

export interface AssignmentContext {
  readonly tenantId: string;
  readonly companyId: string;
  readonly siteId: string | null;
  readonly creatorId: string;
  /** The instant delegations are checked at. */
  readonly at: Date;
}

const unique = (rows: readonly CandidateRow[]): CandidateRow[] => [...new Map(rows.map((row) => [row.userId, row])).values()];
const participantIds = (step: StepDocument, type: 'USER' | 'POSITION' | 'GROUP'): string[] =>
  step.candidates.flatMap((candidate) => (candidate.participantType !== type ? [] : [(type === 'USER' ? candidate.userId : type === 'POSITION' ? candidate.positionId : candidate.groupId)!]));

/** Finds the people a step can be assigned to for a ticket, by the step's assignment mode. */
@Injectable()
export class AssignmentResolver {
  constructor(
    @Inject(AssignmentCandidatesRepository) private readonly candidates: AssignmentCandidatesRepository,
    @Inject(TicketContextRepository) private readonly context: TicketContextRepository,
    @Inject(ApproverResolver) private readonly approvers: ApproverResolver,
  ) {}

  async candidatesFor(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<AssigneeCandidate[]> {
    const rows = await this.rowsFor(tx, step, ticket);
    return unique(rows).map(({ userId, name }) => ({ userId, name }));
  }

  private async rowsFor(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<CandidateRow[]> {
    const { tenantId } = ticket;
    switch (step.assignmentMode) {
      case 'POSITION':
        return step.positionId === null ? [] : this.byPosition(tx, [step.positionId], step, ticket);
      case 'USERS':
        return this.candidates.byUsers(tx, tenantId, participantIds(step, 'USER'));
      case 'GROUP':
        return this.candidates.byGroups(tx, tenantId, participantIds(step, 'GROUP'));
      case 'CREATOR':
        return this.single(tx, ticket, ticket.creatorId);
      case 'APPROVER':
        return this.single(tx, ticket, await this.approverOf(tx, step, ticket));
      case 'POOL': {
        const positions = [...participantIds(step, 'POSITION'), ...(step.positionId === null ? [] : [step.positionId])];
        return [
          ...(await this.candidates.byUsers(tx, tenantId, participantIds(step, 'USER'))),
          ...(await this.candidates.byGroups(tx, tenantId, participantIds(step, 'GROUP'))),
          ...(await this.byPosition(tx, positions, step, ticket)),
        ];
      }
      default:
        // PARALLEL, RANDOM_DISPATCH and NONE are refused by the assignment policy.
        return [];
    }
  }

  private async byPosition(tx: TenantTransaction, positionIds: readonly string[], step: StepDocument, ticket: AssignmentContext): Promise<CandidateRow[]> {
    const found: CandidateRow[] = [];
    for (const positionId of [...new Set(positionIds)]) found.push(...(await this.candidates.byPosition(tx, ticket.tenantId, positionId, ticket.companyId)));
    const ancestry = ticket.siteId === null || step.siteScope !== 'PARENT_SITE' ? [] : await this.context.siteAncestry(tx, ticket.tenantId, ticket.siteId);
    return filterBySiteScope(unique(found), step.siteScope, ticket.siteId, ancestry);
  }

  private async single(tx: TenantTransaction, ticket: AssignmentContext, userId: string): Promise<CandidateRow[]> {
    const member = await this.context.findActiveMember(tx, ticket.tenantId, userId);
    return member === null ? [] : [{ userId: member.userId, name: member.name, siteId: member.siteId }];
  }

  private async approverOf(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<string> {
    const resolution = await this.approvers.resolveIn(tx, {
      creatorId: ticket.creatorId,
      companyId: ticket.companyId,
      typeId: step.approvalGroupTypeId!,
      level: step.approvalLevel!,
      at: ticket.at,
    });
    return resolution.approverId;
  }
}
