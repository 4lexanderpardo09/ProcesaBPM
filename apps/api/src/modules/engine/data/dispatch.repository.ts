import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction, TenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

export interface WaitingTicket {
  readonly id: string;
  readonly workflowVersionId: string;
  readonly companyId: string;
  readonly siteId: string | null;
  readonly creatorId: string;
  readonly batchId: string | null;
}

/** The worker's reads and writes for handing out tickets of RANDOM_DISPATCH steps. Callers pass the tenant's transaction. */
@Injectable()
export class DispatchRepository {
  /** The steps due for a dispatch, across tenants (a worker function that stamps them atomically). Only ids come back. */
  claimDueSteps(tx: CrossTenantTransaction, limit: number): Promise<Array<{ tenantId: string; stepId: string }>> {
    return tx.$queryRaw`SELECT out_tenant_id::text AS "tenantId", out_step_id::text AS "stepId" FROM claim_random_dispatch_steps(${limit}::int)`;
  }

  /** Locks the step's state row, so two runs never serve the same step at once; `false` when it has none. */
  async lockStep(tx: TenantTransaction, tenantId: string, stepId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<unknown[]>`
      SELECT 1 FROM step_runtime_states WHERE tenant_id = ${tenantId}::uuid AND step_id = ${stepId}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  /** Open tickets each of the people holds in the step now: what they still have to do there. */
  async loadAtStep(tx: TenantTransaction, tenantId: string, stepId: string, userIds: readonly string[]): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<Array<{ userId: string; open: number }>>`
      SELECT a.user_id::text AS "userId", count(DISTINCT t.id)::int AS "open"
      FROM ticket_assignees a
      JOIN tickets t ON t.tenant_id = a.tenant_id AND t.id = a.ticket_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.type = 'PRIMARY' AND a.user_id = ANY(${[...userIds]}::uuid[])
        AND t.status = 'OPEN' AND t.current_step_id = ${stepId}::uuid
      GROUP BY a.user_id`;
    return new Map(rows.map((row) => [row.userId, row.open]));
  }

  /** Who already holds an open ticket of each batch in the step (part of it went out in an earlier run). */
  async batchHolders(tx: TenantTransaction, tenantId: string, stepId: string, batchIds: readonly string[]): Promise<Map<string, string>> {
    if (batchIds.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ batchId: string; userId: string }>>`
      SELECT DISTINCT ON (t.batch_id) t.batch_id::text AS "batchId", a.user_id::text AS "userId"
      FROM tickets t
      JOIN ticket_assignees a ON a.tenant_id = t.tenant_id AND a.ticket_id = t.id AND a.type = 'PRIMARY'
      WHERE t.tenant_id = ${tenantId}::uuid AND t.batch_id = ANY(${[...batchIds]}::uuid[])
        AND t.status = 'OPEN' AND t.current_step_id = ${stepId}::uuid
      ORDER BY t.batch_id, a.user_id`;
    return new Map(rows.map((row) => [row.batchId, row.userId]));
  }

  /** Open tickets in the step with a running clock nobody is responsible for and nobody holding them; locked, oldest first. */
  waiting(tx: TenantTransaction, tenantId: string, stepId: string, limit: number): Promise<WaitingTicket[]> {
    return tx.$queryRaw<WaitingTicket[]>`
      SELECT t.id::text AS "id", t.workflow_version_id::text AS "workflowVersionId", t.company_id::text AS "companyId",
             t.site_id::text AS "siteId", t.creator_id::text AS "creatorId", t.batch_id::text AS "batchId"
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
  async hasHolder(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<boolean> {
    return (await tx.ticketAssignee.count({ where: { tenantId, ticketId } })) > 0;
  }

  /** One ticket's work can fail without losing the others: it runs inside a savepoint. */
  async inSavepoint<T>(tx: TenantTransaction, work: () => Promise<T>): Promise<T | undefined> {
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
