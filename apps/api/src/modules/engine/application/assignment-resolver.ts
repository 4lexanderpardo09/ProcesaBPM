import { Inject, Injectable } from '@nestjs/common';
import {
  type AssigneeCandidate,
  ApproverNotFoundError,
  InvalidAssigneeError,
  InvalidStateError,
  NoAssigneeCandidatesError,
  type SignerChoices,
  SignerSelectionRequiredError,
  type StepDocument,
} from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ApproverResolver } from '../../approvals/application/approver-resolver.service.js';
import { AssignmentCandidatesRepository, type CandidateRow } from '../data/assignment-candidates.repository.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { pickSignerHolder } from '../domain/parallel-policy.js';
import { filterBySiteScope } from '../domain/site-scope.js';

export interface AssignmentContext {
  readonly tenantId: string;
  readonly companyId: string;
  readonly siteId: string | null;
  readonly creatorId: string;
  /** `null` while the ticket is being created (no step of it was delivered yet). */
  readonly ticketId: string | null;
  /** The instant delegations are checked at. */
  readonly at: Date;
}

type Signer = StepDocument['signers'][number];

/** The signers of a PARALLEL step: the people they resolved to, and the signers that resolved to nobody (to choose by hand). */
export interface SignerResolution {
  readonly people: readonly string[];
  readonly missing: readonly Signer[];
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
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  async candidatesFor(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<AssigneeCandidate[]> {
    const rows = await this.rowsFor(tx, step, ticket);
    return unique(rows).map(({ userId, name }) => ({ userId, name }));
  }

  /**
   * Resolves each signer row of a PARALLEL step to one person (a position to its least loaded holder); the rows that
   * resolve to nobody (no holder, no approver, a person no longer active) are returned apart, to be chosen by hand.
   */
  async resolveSigners(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<SignerResolution> {
    const people: string[] = [];
    const missing: Signer[] = [];
    for (const signer of [...step.signers].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const userId = await this.signerUser(tx, step, signer, ticket);
      if (userId === undefined) missing.push(signer);
      else people.push(userId);
    }
    return { people, missing };
  }

  /**
   * The people who each sign a PARALLEL step; repeated people count once. As in the help desk, a signer that resolves
   * to nobody takes the person chosen for it among the company's members, or is left out when the choice is `null`;
   * without a choice for it the arrival asks for one. Leaving every signature out is refused: someone has to sign.
   */
  async signersFor(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext, choices: SignerChoices = []): Promise<string[]> {
    const { people, missing } = await this.resolveSigners(tx, step, ticket);
    const unanswered = missing.filter((signer) => !choices.some((choice) => choice.signerId === signer.id));
    if (unanswered.length > 0) throw new SignerSelectionRequiredError(step.id, unanswered.map((signer) => signer.id));
    const chosen = missing.flatMap((signer) => {
      const userId = choices.find((choice) => choice.signerId === signer.id)!.userId;
      return userId === null ? [] : [userId];
    });
    if (chosen.length > 0) {
      const members = new Set((await this.candidates.byCompany(tx, ticket.tenantId, ticket.companyId)).map((member) => member.userId));
      if (chosen.some((userId) => !members.has(userId))) throw new InvalidAssigneeError();
    }
    const everyone = [...new Set([...people, ...chosen])];
    if (everyone.length === 0) throw new NoAssigneeCandidatesError(step.id, 'PARALLEL');
    return everyone;
  }

  /** Who may be picked by hand for a signer or an approver that resolved to nobody: the company's active members. */
  async companyMembers(tx: TenantTransaction, ticket: AssignmentContext): Promise<AssigneeCandidate[]> {
    return (await this.candidates.byCompany(tx, ticket.tenantId, ticket.companyId)).map(({ userId, name }) => ({ userId, name }));
  }

  /** What a signer is called to the person choosing for it: its own label, else the name of its position. */
  async signerLabel(tx: TenantTransaction, tenantId: string, signer: Signer): Promise<string | null> {
    if (signer.label !== null && signer.label.trim() !== '') return signer.label;
    if (signer.signerType !== 'POSITION' || signer.positionId === null) return null;
    return (await tx.position.findFirst({ where: { tenantId, id: signer.positionId }, select: { name: true } }))?.name ?? null;
  }

  /** The names of active members, in the order given (a person no longer active is left out). */
  async named(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<AssigneeCandidate[]> {
    const people: AssigneeCandidate[] = [];
    for (const userId of userIds) {
      const member = await this.context.findActiveMember(tx, tenantId, userId);
      if (member !== null) people.push({ userId: member.userId, name: member.name });
    }
    return people;
  }

  private async signerUser(tx: TenantTransaction, step: StepDocument, signer: Signer, ticket: AssignmentContext): Promise<string | undefined> {
    switch (signer.signerType) {
      case 'USER':
        return signer.userId === null ? undefined : (await this.single(tx, ticket, signer.userId))[0]?.userId;
      case 'CREATOR':
        return (await this.single(tx, ticket, ticket.creatorId))[0]?.userId;
      case 'APPROVER': {
        const approverId = await this.approverOrNone(tx, step, ticket);
        return approverId === undefined ? undefined : (await this.single(tx, ticket, approverId))[0]?.userId;
      }
      case 'POSITION': {
        if (signer.positionId === null) return undefined;
        const holders = await this.byPosition(tx, [signer.positionId], step, ticket);
        if (holders.length === 0) return undefined;
        const ids = holders.map((holder) => holder.userId);
        return pickSignerHolder(ids, await this.writes.assignmentLoads(tx, ticket.tenantId, ids));
      }
      case 'STEP_ASSIGNEE':
        throw new InvalidStateError('A parallel step cannot have signers that are the step assignee');
    }
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
      case 'APPROVER': {
        // No approver to find leaves no candidates: the arrival then lets the approver be chosen by hand.
        const approverId = await this.approverOrNone(tx, step, ticket);
        return approverId === undefined ? [] : this.single(tx, ticket, approverId);
      }
      case 'SAME_AS_STEP': {
        const deliverer = ticket.ticketId === null || step.sameAssigneeStepId === null ? undefined : await this.writes.lastDelivererOf(tx, tenantId, ticket.ticketId, step.sameAssigneeStepId);
        return deliverer === undefined ? [] : this.single(tx, ticket, deliverer);
      }
      case 'POOL':
      case 'RANDOM_DISPATCH': {
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

  /** The approver, or `undefined` when there is none to find (to be chosen by hand instead). */
  private async approverOrNone(tx: TenantTransaction, step: StepDocument, ticket: AssignmentContext): Promise<string | undefined> {
    try {
      return await this.approverOf(tx, step, ticket);
    } catch (error) {
      if (error instanceof ApproverNotFoundError) return undefined;
      throw error;
    }
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
