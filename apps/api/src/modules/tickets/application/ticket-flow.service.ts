import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type TicketFlowResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketFlowRepository } from '../data/ticket-flow.repository.js';
import { ticketFlowOf } from '../domain/ticket-flow.js';
import { readableTickets } from './ticket-access.js';

/**
 * The diagram of a ticket's progress, for whoever may read the ticket: reading the ticket is enough to see the graph
 * of the version it runs on (no `read Workflow`), which is why only the diagram's parts of the version go out.
 */
@Injectable()
export class TicketFlowService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketFlowRepository) private readonly tickets: TicketFlowRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
  ) {}

  flow(ability: AppAbility, ticketId: string): Promise<TicketFlowResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      // The access filter is part of the query: a ticket the caller may not read answers like one that does not exist.
      const ticket = await this.tickets.findProgress(tx, tenantId, ticketId, readableTickets(ability));
      if (ticket === null) throw new NotFoundError();
      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      return ticketFlowOf(document, {
        ticketId: ticket.id,
        versionId: ticket.workflowVersionId,
        status: ticket.status,
        currentStepId: ticket.currentStepId,
        visitedStepIds: ticket.stepVisits.map((visit) => visit.stepId),
        takenTransitionIds: ticket.events.flatMap((event) => (event.transitionId === null ? [] : [event.transitionId])),
      });
    });
  }
}
