import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TicketForExport {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly timeZone: string;
  readonly createdAt: Date;
  readonly currentStepId: string | null;
  readonly requester: { readonly firstName: string; readonly lastName: string; readonly email: string; readonly documentNumber: string | null };
  /** Stored values by field id. */
  readonly values: ReadonlyMap<string, unknown>;
}

/** What a line is built from, read once per ticket. Callers pass the tenant's transaction. */
@Injectable()
export class ExportSourcesRepository {
  async ticket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketForExport | undefined> {
    const ticket = await tx.ticket.findFirst({
      where: { tenantId, id: ticketId, deletedAt: null },
      select: {
        id: true,
        workflowId: true,
        workflowVersionId: true,
        companyId: true,
        createdAt: true,
        currentStepId: true,
        company: { select: { name: true, timeZone: true } },
        creator: { select: { user: { select: { firstName: true, lastName: true, email: true, documentNumber: true } } } },
        fieldValues: { select: { fieldId: true, value: true } },
      },
    });
    if (ticket === null) return undefined;
    return {
      id: ticket.id,
      workflowId: ticket.workflowId,
      workflowVersionId: ticket.workflowVersionId,
      companyId: ticket.companyId,
      companyName: ticket.company.name,
      timeZone: ticket.company.timeZone,
      createdAt: ticket.createdAt,
      currentStepId: ticket.currentStepId,
      requester: ticket.creator.user,
      values: new Map(ticket.fieldValues.map((row) => [row.fieldId, row.value])),
    };
  }

  /** The label of a transition of a version (lines are matched by label, which stays the same across versions). */
  async transitionLabel(tx: TenantTransaction, tenantId: string, transitionId: string): Promise<string | undefined> {
    return (await tx.transition.findFirst({ where: { tenantId, id: transitionId }, select: { label: true } }))?.label ?? undefined;
  }

  /** The newest ticket of a workflow (for the preview), optionally of one company. */
  async newestTicketId(tx: TenantTransaction, tenantId: string, workflowId: string, companyId: string | null): Promise<string | undefined> {
    return (await tx.ticket.findFirst({ where: { tenantId, workflowId, deletedAt: null, ...(companyId === null ? {} : { companyId }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } }))?.id;
  }

  /**
   * Where each ticket stands for a step: on it or not, and its single holder there (files separated by responsible).
   * The step is matched by name, so the tickets of every version of the workflow count.
   */
  async holdersOn(tx: TenantTransaction, tenantId: string, ticketIds: readonly string[], stepName: string): Promise<Map<string, { onStep: boolean; userId: string | null }>> {
    if (ticketIds.length === 0) return new Map();
    const tickets = await tx.ticket.findMany({
      where: { tenantId, id: { in: [...ticketIds] } },
      select: { id: true, status: true, currentStep: { select: { name: true } }, assignees: { where: { type: 'PRIMARY' }, select: { userId: true } } },
    });
    return new Map(
      tickets.map((ticket) => {
        const onStep = ticket.status !== 'CLOSED' && ticket.currentStep?.name === stepName;
        return [ticket.id, { onStep, userId: onStep && ticket.assignees.length === 1 ? ticket.assignees[0]!.userId : null }];
      }),
    );
  }

  async stepName(tx: TenantTransaction, tenantId: string, stepId: string): Promise<string | undefined> {
    return (await tx.step.findFirst({ where: { tenantId, id: stepId }, select: { name: true } }))?.name;
  }

  async names(tx: TenantTransaction, tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await tx.membership.findMany({ where: { tenantId, userId: { in: [...userIds] } }, select: { userId: true, user: { select: { firstName: true, lastName: true } } } });
    return new Map(rows.map((row) => [row.userId, `${row.user.firstName} ${row.user.lastName}`.trim()]));
  }

  async workflowName(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<string | undefined> {
    return (await tx.workflow.findFirst({ where: { tenantId, id: workflowId }, select: { name: true } }))?.name;
  }

  async defaultTimeZone(tx: TenantTransaction, tenantId: string, companyId: string | null): Promise<string> {
    const company = await tx.company.findFirst({ where: { tenantId, ...(companyId === null ? { isDefault: true } : { id: companyId }) }, select: { timeZone: true } });
    return company?.timeZone ?? 'UTC';
  }
}
