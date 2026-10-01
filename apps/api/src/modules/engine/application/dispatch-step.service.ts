import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { DispatchRepository, type WaitingTicket } from '../data/dispatch.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { pickRoundRobin } from '../domain/round-robin.js';
import { AssignmentResolver } from './assignment-resolver.js';

/** A step's tickets are handed out in small batches so one run stays well inside the transaction time. */
const BATCH = 50;

/**
 * Hands out the tickets waiting in a RANDOM_DISPATCH step, round-robin over the candidates in id order (the
 * pointer lives in `step_runtime_states`). Runs as the worker inside the tenant of the step, with no user. It locks
 * the pointer first and the tickets with SKIP LOCKED, so a request that holds a ticket (the API locks tickets
 * first and never the pointer) is never waited for: no lock cycle. The clock keeps its start: waiting counts.
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
      const pointer = await this.dispatches.lockPointer(tx, tenantId, stepId);
      if (pointer === undefined) return 0;
      let last = pointer.last;
      let assigned = 0;
      for (const ticket of await this.dispatches.waiting(tx, tenantId, stepId, BATCH)) {
        const chosen = await this.dispatches.inSavepoint(tx, () => this.assign(tx, tenantId, stepId, ticket, last, at));
        if (chosen !== undefined && chosen !== null) {
          last = chosen;
          assigned += 1;
        }
      }
      if (assigned > 0 && last !== null) await this.dispatches.savePointer(tx, tenantId, stepId, last);
      return assigned;
    });
  }

  /** The person the ticket went to, or `null` when it was skipped (somebody holds it already, or there is nobody eligible). */
  private async assign(tx: WorkerTransaction, tenantId: string, stepId: string, ticket: WaitingTicket, last: string | null, at: Date): Promise<string | null> {
    if (await this.dispatches.hasHolder(tx, tenantId, ticket.id)) return null;
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const step = document.steps.find((candidate) => candidate.id === stepId);
    if (step === undefined) return null;
    const candidates = await this.resolver.candidatesFor(tx, step, { tenantId, companyId: ticket.companyId, siteId: ticket.siteId, creatorId: ticket.creatorId, at });
    if (candidates.length === 0) return null;
    const chosen = pickRoundRobin(candidates.map((candidate) => candidate.userId), last);
    const visit = (await this.writes.findOpenVisit(tx, tenantId, ticket.id))!;
    await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: chosen, type: 'PRIMARY' }]);
    for (const clock of await this.writes.findOpenClocks(tx, tenantId, visit.id)) {
      if (clock.responsibleId === null) await this.writes.assignClockResponsible(tx, tenantId, clock.id, chosen);
    }
    await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
      type: 'ASSIGNED',
      stepId,
      loop: visit.loop,
      actorId: null,
      assigneeId: chosen,
      data: { assigneeType: 'PRIMARY', dispatched: true },
      outbox: [{ type: 'ticket.assigned', payload: { stepId, loop: visit.loop, userId: chosen, assigneeType: 'PRIMARY' } }],
    });
    return chosen;
  }
}
