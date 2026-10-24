import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { Where } from './ticket-query.repository.js';

/**
 * What a ticket's way through its version left behind: one row per visit (people steps and WAIT blocks) and one
 * `TRANSITIONED` event per transition taken (automatic hops included): ids for the diagram, and the times of each visit.
 */
const PROGRESS = {
  id: true,
  status: true,
  workflowVersionId: true,
  currentStepId: true,
  stepVisits: { select: { stepId: true, loop: true, enteredAt: true, exitedAt: true, dueAt: true, result: true }, orderBy: { enteredAt: 'asc' } },
  events: { where: { type: 'TRANSITIONED', transitionId: { not: null } }, select: { transitionId: true } },
} as const;

/** Reads of a ticket's progress. The caller passes the access filter (per-record authorization): it is part of the query. */
@Injectable()
export class TicketFlowRepository {
  findProgress(tx: TenantTransaction, tenantId: string, ticketId: string, access: Where) {
    return tx.ticket.findFirst({ where: { AND: [{ tenantId, id: ticketId, deletedAt: null }, access] } as never, select: PROGRESS });
  }
}
