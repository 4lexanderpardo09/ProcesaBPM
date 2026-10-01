import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { pickRoundRobin } from '../domain/round-robin.js';
import { AssignmentResolver } from './assignment-resolver.js';

const BATCH = 500;

interface WaitingTicket {
  id: string;
  workflowVersionId: string;
  companyId: string;
  siteId: string | null;
  creatorId: string;
}

/**
 * Hands out the tickets waiting in a RANDOM_DISPATCH step, round-robin over the candidates in id order (the
 * pointer lives in `step_runtime_states`). Runs as the worker inside the tenant of the step, with no user. It locks
 * the pointer first and the tickets with SKIP LOCKED, so a request that holds a ticket (the API locks tickets
 * first and never the pointer) is never waited for: no lock cycle. The clock keeps its start: waiting counts.
 */
@Injectable()
export class DispatchStepService {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(AssignmentResolver) private readonly resolver: AssignmentResolver,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  /** Returns how many tickets got a person. */
  dispatchStep(tenantId: string, stepId: string): Promise<number> {
    return this.runner.withTenant(tenantId, async (tx) => {
      const at = this.clock.now();
      const [state] = await tx.$queryRaw<Array<{ last: string | null }>>`
        SELECT last_assigned_user_id::text AS "last" FROM step_runtime_states
        WHERE tenant_id = ${tenantId}::uuid AND step_id = ${stepId}::uuid FOR UPDATE`;
      if (state === undefined) return 0;
      let last = state.last;
      let assigned = 0;
      for (const ticket of await this.waiting(tx, tenantId, stepId)) {
        const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
        const step = document.steps.find((candidate) => candidate.id === stepId);
        if (step === undefined) continue;
        const candidates = await this.resolver.candidatesFor(tx, step, { tenantId, companyId: ticket.companyId, siteId: ticket.siteId, creatorId: ticket.creatorId, at });
        if (candidates.length === 0) continue;
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
        last = chosen;
        assigned += 1;
      }
      if (assigned > 0) await tx.stepRuntimeState.updateMany({ where: { tenantId, stepId }, data: { lastAssignedUserId: last } });
      return assigned;
    });
  }

  /** Open tickets in the step with a running clock nobody is responsible for and nobody holding them; locked, oldest first. */
  private waiting(tx: WorkerTransaction, tenantId: string, stepId: string): Promise<WaitingTicket[]> {
    return tx.$queryRaw<WaitingTicket[]>`
      SELECT t.id::text AS "id", t.workflow_version_id::text AS "workflowVersionId", t.company_id::text AS "companyId",
             t.site_id::text AS "siteId", t.creator_id::text AS "creatorId"
      FROM tickets t
      JOIN ticket_sla_clocks c ON c.tenant_id = t.tenant_id AND c.ticket_id = t.id
      WHERE t.tenant_id = ${tenantId}::uuid AND t.status = 'OPEN' AND t.current_step_id = ${stepId}::uuid
        AND c.step_id = ${stepId}::uuid AND c.completed_at IS NULL AND c.responsible_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.tenant_id = t.tenant_id AND a.ticket_id = t.id)
      ORDER BY c.started_at, t.id
      LIMIT ${BATCH}
      FOR UPDATE OF t SKIP LOCKED`;
  }
}
