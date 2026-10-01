import { Injectable } from '@nestjs/common';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';

export interface WaitingTicket {
  readonly id: string;
  readonly workflowVersionId: string;
  readonly companyId: string;
  readonly siteId: string | null;
  readonly creatorId: string;
}

/** The worker's reads and writes for handing out tickets of RANDOM_DISPATCH steps. Callers pass the tenant's transaction. */
@Injectable()
export class DispatchRepository {
  /** The steps due for a dispatch, across tenants (a worker function that stamps them atomically). Only ids come back. */
  claimDueSteps(tx: WorkerTransaction, limit: number): Promise<Array<{ tenantId: string; stepId: string }>> {
    return tx.$queryRaw`SELECT out_tenant_id::text AS "tenantId", out_step_id::text AS "stepId" FROM claim_random_dispatch_steps(${limit}::int)`;
  }

  /** Locks the round-robin pointer of the step; `undefined` when it has no state row. */
  async lockPointer(tx: WorkerTransaction, tenantId: string, stepId: string): Promise<{ last: string | null } | undefined> {
    const rows = await tx.$queryRaw<Array<{ last: string | null }>>`
      SELECT last_assigned_user_id::text AS "last" FROM step_runtime_states
      WHERE tenant_id = ${tenantId}::uuid AND step_id = ${stepId}::uuid FOR UPDATE`;
    return rows[0];
  }

  async savePointer(tx: WorkerTransaction, tenantId: string, stepId: string, lastAssignedUserId: string): Promise<void> {
    await tx.stepRuntimeState.updateMany({ where: { tenantId, stepId }, data: { lastAssignedUserId } });
  }

  /** Open tickets in the step with a running clock nobody is responsible for and nobody holding them; locked, oldest first. */
  waiting(tx: WorkerTransaction, tenantId: string, stepId: string, limit: number): Promise<WaitingTicket[]> {
    return tx.$queryRaw<WaitingTicket[]>`
      SELECT t.id::text AS "id", t.workflow_version_id::text AS "workflowVersionId", t.company_id::text AS "companyId",
             t.site_id::text AS "siteId", t.creator_id::text AS "creatorId"
      FROM tickets t
      JOIN ticket_sla_clocks c ON c.tenant_id = t.tenant_id AND c.ticket_id = t.id
      WHERE t.tenant_id = ${tenantId}::uuid AND t.status = 'OPEN' AND t.current_step_id = ${stepId}::uuid
        AND c.step_id = ${stepId}::uuid AND c.completed_at IS NULL AND c.responsible_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.tenant_id = t.tenant_id AND a.ticket_id = t.id)
      ORDER BY c.started_at, t.id
      LIMIT ${limit}
      FOR UPDATE OF t SKIP LOCKED`;
  }

  /** Taking or reassigning does not touch the ticket row, so the lock above does not re-check the filter: look again now. */
  async hasHolder(tx: WorkerTransaction, tenantId: string, ticketId: string): Promise<boolean> {
    return (await tx.ticketAssignee.count({ where: { tenantId, ticketId } })) > 0;
  }

  /** One ticket's work can fail without losing the others: it runs inside a savepoint. */
  async inSavepoint<T>(tx: WorkerTransaction, work: () => Promise<T>): Promise<T | undefined> {
    await tx.$executeRaw`SAVEPOINT dispatch_ticket`;
    try {
      const result = await work();
      await tx.$executeRaw`RELEASE SAVEPOINT dispatch_ticket`;
      return result;
    } catch {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT dispatch_ticket`;
      return undefined;
    }
  }
}
