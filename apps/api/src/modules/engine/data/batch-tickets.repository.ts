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
  readonly company: { readonly id: string; readonly name: string };
  readonly site: { readonly id: string; readonly name: string } | null;
  readonly department: { readonly id: string; readonly name: string } | null;
  /** The last export file the ticket went out in, if any. */
  readonly cutoff: { readonly id: string; readonly cutoffDate: Date; readonly definitionName: string; readonly groupLabel: string | null } | null;
  /** The ticket's values by field code. */
  readonly values: Readonly<Record<string, unknown>>;
}

/** Reads for the batch inbox. Callers pass the tenant's transaction. */
@Injectable()
export class BatchTicketsRepository {
  /**
   * Open tickets the person holds (alone or in a pool) whose current step can be answered in a batch, with their open
   * visit. With `cutoffId`, only the tickets that went out in that export file.
   */
  async heldOnBatchSteps(tx: TenantTransaction, tenantId: string, userId: string, cutoffId?: string): Promise<BatchTicketRow[]> {
    const tickets = await tx.ticket.findMany({
      where: {
        tenantId,
        status: 'OPEN',
        deletedAt: null,
        assignees: { some: { userId, type: { in: ['PRIMARY', 'POOL'] } } },
        currentStep: { allowsBatch: true },
        ...(cutoffId === undefined ? {} : { exportLines: { some: { cutoffId } } }),
      },
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
        company: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        exportLines: { where: { cutoffId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { cutoff: { select: { id: true, cutoffDate: true, groupLabel: true, definition: { select: { name: true } } } } } },
        fieldValues: { select: { value: true, field: { select: { code: true } } } },
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
          company: ticket.company,
          site: ticket.site,
          department: ticket.department,
          cutoff: cutoffOf(ticket.exportLines[0]?.cutoff),
          values: Object.fromEntries(ticket.fieldValues.map((entry) => [entry.field.code, entry.value])),
        },
      ];
    });
  }
}

function cutoffOf(cutoff: { id: string; cutoffDate: Date; groupLabel: string | null; definition: { name: string } } | null | undefined): BatchTicketRow['cutoff'] {
  return cutoff === null || cutoff === undefined ? null : { id: cutoff.id, cutoffDate: cutoff.cutoffDate, definitionName: cutoff.definition.name, groupLabel: cutoff.groupLabel };
}
