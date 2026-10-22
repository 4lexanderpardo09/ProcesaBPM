import { Inject, Injectable } from '@nestjs/common';
import { PEOPLE_STEP_TYPES } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { lastPeopleStep } from '../domain/reopen-policy.js';
import { decisionExits, type TicketAction } from '../domain/ticket-action-rules.js';
import type { TicketActionState } from '../domain/ticket-actions.js';
import type { TicketActor } from './locked-ticket.js';

const ACTIONS: readonly TicketAction[] = ['transition', 'reassign', 'close', 'open_incident', 'reopen', 'comment', 'report_error'];

/**
 * Reads, without locking, what the action rules need to judge a ticket for one caller: the same rows the engine
 * services read under the lock, through the same repository, and every permission checked on this very ticket.
 * The caller must already know the ticket is readable (a ticket that is not there answers `null`).
 */
@Injectable()
export class TicketActionStateReader {
  constructor(
    @Inject(TicketWriteRepository) private readonly tickets: TicketWriteRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
  ) {}

  async read(tx: TenantTransaction, tenantId: string, ticketId: string, actor: TicketActor): Promise<TicketActionState | null> {
    const ticket = await this.tickets.findTicket(tx, tenantId, ticketId);
    if (ticket === undefined) return null;
    // One query after another: an interactive transaction has a single connection.
    const visit = ticket.status === 'CLOSED' ? null : await this.tickets.findOpenVisit(tx, tenantId, ticket.id);
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const step = visit === null ? undefined : document.steps.find((candidate) => candidate.id === visit.stepId);
    const peopleSteps = new Set(document.steps.filter((candidate) => PEOPLE_STEP_TYPES.has(candidate.type)).map((candidate) => candidate.id));
    const grants: Record<TicketAction, boolean> = { transition: false, reassign: false, close: false, open_incident: false, reopen: false, comment: false, report_error: false };
    for (const action of ACTIONS) grants[action] = await actor.can(tx, ticket.id, action);
    return {
      actorId: actor.userId,
      status: ticket.status,
      companyId: ticket.companyId,
      visit: visit === null ? null : { id: visit.id, stepId: visit.stepId, resumeAt: visit.resumeAt },
      step,
      hasDecisionExit: step !== undefined && decisionExits(document, step.id).length > 0,
      assignees: await this.tickets.findAssignees(tx, tenantId, ticket.id),
      signatures: visit === null ? [] : await this.tickets.findParallelTasks(tx, tenantId, ticket.id, visit.stepId, visit.loop),
      openIncident: ticket.status === 'PAUSED' ? await this.tickets.findOpenIncident(tx, tenantId, ticket.id) : null,
      hasReopenTarget: ticket.status === 'CLOSED' && lastPeopleStep(await this.tickets.findVisits(tx, tenantId, ticket.id), peopleSteps) !== undefined,
      grants,
    };
  }
}
