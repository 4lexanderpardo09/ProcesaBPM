import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** The most tickets the batch inbox lists at once (the oldest first). */
const BATCH_LIST_LIMIT = 500;

export interface BatchTicketRow {
  readonly id: string;
  readonly number: bigint;
  readonly title: string;
  readonly createdAt: Date;
  readonly workflowVersionId: string;
  readonly currentStepId: string;
  readonly workflowName: string;
  readonly companyName: string;
  readonly requester: { readonly id: string; readonly firstName: string; readonly lastName: string };
  readonly visitId: string;
  readonly dueAt: Date | null;
}

/** Reads for the batch inbox. Callers pass the tenant's transaction. */
@Injectable()
export class BatchTicketsRepository {
  /** Open tickets the person holds (alone or in a pool) whose current step can be answered in a batch, with their open visit. */
  async heldOnBatchSteps(tx: TenantTransaction, tenantId: string, userId: string): Promise<BatchTicketRow[]> {
    const tickets = await tx.ticket.findMany({
      where: { tenantId, status: 'OPEN', deletedAt: null, assignees: { some: { userId, type: { in: ['PRIMARY', 'POOL'] } } }, currentStep: { allowsBatch: true } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_LIST_LIMIT,
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        workflowVersionId: true,
        currentStepId: true,
        workflow: { select: { name: true } },
        company: { select: { name: true } },
        creator: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
        stepVisits: { where: { exitedAt: null }, select: { id: true, dueAt: true }, take: 1 },
      },
    });
    return tickets.flatMap((ticket) => {
      const visit = ticket.stepVisits[0];
      if (visit === undefined || ticket.currentStepId === null) return [];
      return [
        {
          id: ticket.id,
          number: ticket.number,
          title: ticket.title,
          createdAt: ticket.createdAt,
          workflowVersionId: ticket.workflowVersionId,
          currentStepId: ticket.currentStepId,
          workflowName: ticket.workflow.name,
          companyName: ticket.company.name,
          requester: { id: ticket.creator.userId, firstName: ticket.creator.user.firstName, lastName: ticket.creator.user.lastName },
          visitId: visit.id,
          dueAt: visit.dueAt,
        },
      ];
    });
  }
}
