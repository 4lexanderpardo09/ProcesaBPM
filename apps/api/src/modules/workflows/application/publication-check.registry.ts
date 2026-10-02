import { Injectable } from '@nestjs/common';
import type { WorkflowProblem, WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PublicationCheck {
  check(tx: TenantTransaction, tenantId: string, workflowId: string, document: WorkflowVersionDocument): Promise<WorkflowProblem[]>;
}

/**
 * Other modules add what a draft must satisfy before it is published (documents check theirs against the draft's
 * fields and steps). The dependency goes one way: they register here, the workflows module never imports them.
 */
@Injectable()
export class PublicationCheckRegistry {
  private readonly checks: PublicationCheck[] = [];

  register(check: PublicationCheck): void {
    this.checks.push(check);
  }

  async run(tx: TenantTransaction, tenantId: string, workflowId: string, document: WorkflowVersionDocument): Promise<WorkflowProblem[]> {
    const problems: WorkflowProblem[] = [];
    for (const check of this.checks) problems.push(...(await check.check(tx, tenantId, workflowId, document)));
    return problems;
  }
}
