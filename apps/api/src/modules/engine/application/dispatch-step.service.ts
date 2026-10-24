import { Inject, Injectable } from '@nestjs/common';
import type { StepDocument } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { DispatchRepository, type WaitingTicket } from '../data/dispatch.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { planDispatch } from '../domain/dispatch-plan.js';
import { AssignmentResolver } from './assignment-resolver.js';

/** A step's tickets are handed out in small batches so one run stays well inside the transaction time. */
const BATCH = 50;

interface Resolved {
  readonly ticket: WaitingTicket;
  readonly step: StepDocument;
}

/**
 * Hands out the tickets waiting in a RANDOM_DISPATCH step, balanced as the help desk does it (`planDispatch`): to
 * whoever holds the fewest open tickets of the step, a batch whole to one person, ties at random. Tickets whose
 * people differ (company, site) are planned apart. Runs as the worker inside the tenant of the step, with no user. It
 * locks the step's state row first and the tickets with SKIP LOCKED, so a request that holds a ticket (the API locks
 * tickets first and never that row) is never waited for: no lock cycle. The clock keeps its start: waiting counts.
 * Each ticket is its own savepoint: one that fails is skipped and the next run tries it again.
 */
@Injectable()
export class DispatchStepService {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(AssignmentResolver) private readonly resolver: AssignmentResolver,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(DispatchRepository) private readonly dispatches: DispatchRepository,
  ) {}

  /** Returns how many tickets got a person. */
  dispatchStep(tenantId: string, stepId: string): Promise<number> {
    return this.runner.withTenant(tenantId, async (tx) => {
      const at = this.clock.now();
      if (!(await this.dispatches.lockStep(tx, tenantId, stepId))) return 0;
      let assigned = 0;
      for (const { candidateIds, tickets } of (await this.groupByPeople(tx, tenantId, stepId, at)).values()) {
        const batchIds = [...new Set(tickets.flatMap(({ ticket }) => (ticket.batchId === null ? [] : [ticket.batchId])))];
        const plan = planDispatch({
          tickets: tickets.map((resolved) => ({ ...resolved, id: resolved.ticket.id, batchId: resolved.ticket.batchId })),
          candidateIds,
          load: await this.dispatches.loadAtStep(tx, tenantId, stepId, candidateIds),
          batchHolders: await this.dispatches.batchHolders(tx, tenantId, stepId, batchIds),
        });
        for (const { ticket, userId } of plan) {
          if ((await this.dispatches.inSavepoint(tx, () => this.assign(tx, tenantId, ticket.step, ticket.ticket, userId, at))) === true) assigned += 1;
        }
      }
      return assigned;
    });
  }

  /** The waiting tickets nobody holds, grouped by the people that can take each one (in the typical step, one group). */
  private async groupByPeople(tx: TenantTransaction, tenantId: string, stepId: string, at: Date): Promise<Map<string, { candidateIds: string[]; tickets: Resolved[] }>> {
    const groups = new Map<string, { candidateIds: string[]; tickets: Resolved[] }>();
    for (const ticket of await this.dispatches.waiting(tx, tenantId, stepId, BATCH)) {
      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const step = document.steps.find((candidate) => candidate.id === stepId);
      if (step === undefined) continue;
      const candidates = await this.resolver.candidatesFor(tx, step, { tenantId, companyId: ticket.companyId, siteId: ticket.siteId, creatorId: ticket.creatorId, ticketId: ticket.id, at });
      const candidateIds = [...new Set(candidates.map((candidate) => candidate.userId))].sort();
      if (candidateIds.length === 0) continue;
      const key = candidateIds.join(',');
      const group = groups.get(key) ?? { candidateIds, tickets: [] };
      group.tickets.push({ ticket, step });
      groups.set(key, group);
    }
    return groups;
  }

  /** `false` when it was skipped: somebody took or got it since it was read. */
  private async assign(tx: TenantTransaction, tenantId: string, step: StepDocument, ticket: WaitingTicket, chosen: string, at: Date): Promise<boolean> {
    if (await this.dispatches.hasHolder(tx, tenantId, ticket.id)) return false;
    const visit = (await this.writes.findOpenVisit(tx, tenantId, ticket.id))!;
    await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: chosen, type: 'PRIMARY' }]);
    for (const clock of await this.writes.findOpenClocks(tx, tenantId, visit.id)) {
      if (clock.responsibleId === null) await this.writes.assignClockResponsible(tx, tenantId, clock.id, chosen);
    }
    await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
      type: 'ASSIGNED',
      stepId: step.id,
      loop: visit.loop,
      actorId: null,
      assigneeId: chosen,
      data: { assigneeType: 'PRIMARY', dispatched: true },
      outbox: [{ type: 'ticket.assigned', payload: { stepId: step.id, loop: visit.loop, userId: chosen, assigneeType: 'PRIMARY' } }],
    });
    return true;
  }
}
