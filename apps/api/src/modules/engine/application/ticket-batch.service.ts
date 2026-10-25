import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type BatchTransitionRequest, type BatchTransitionResponse, type BatchTransitionResult, DomainError, NotFoundError, type TicketBatchGroup } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { BatchTicketsRepository } from '../data/batch-tickets.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { batchLimitOf, batchRefusal } from '../domain/batch-policy.js';
import { batchSubgroupOf, batchTrayOf } from '../domain/batch-tray.js';
import { decisionExits } from '../domain/ticket-action-rules.js';
import type { TicketActor } from './locked-ticket.js';
import { TransitionTicketService } from './transition-ticket.service.js';

/**
 * Answering several tickets of the same step at once ("procesar en lote"): whoever holds them picks one decision and
 * fills the step once. Each ticket is still a full transition in its own transaction (fields, caps, history,
 * documents), so one that fails leaves the others moved and the answer says which one and why.
 */
@Injectable()
export class TicketBatchService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(BatchTicketsRepository) private readonly batches: BatchTicketsRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(TransitionTicketService) private readonly transitions: TransitionTicketService,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * The caller's tickets on batch steps, a group per step of a workflow version, in the order they arrived, each with the
   * data and the part of the tray its step asks for. With `cutoffId`, only those that went out in that export file.
   */
  groups(actor: TicketActor, cutoffId?: string): Promise<TicketBatchGroup[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const groups = new Map<string, TicketBatchGroup & { tickets: TicketBatchGroup['tickets'][number][] }>();
      for (const row of await this.batches.heldOnBatchSteps(tx, tenantId, actor.userId, cutoffId)) {
        const key = `${row.workflowVersionId}:${row.currentStepId}`;
        let group = groups.get(key);
        if (group === undefined) {
          const document = await this.versions.documentOf(tx, tenantId, row.workflowVersionId);
          const step = document.steps.find((candidate) => candidate.id === row.currentStepId);
          if (step === undefined) continue;
          group = {
            workflowVersionId: row.workflowVersionId,
            stepId: step.id,
            stepName: step.name,
            workflowName: row.workflowName,
            maxTickets: batchLimitOf(step),
            ...batchTrayOf(step, document.fields),
            decisions: decisionExits(document, step.id).map((transition) => ({ transitionId: transition.id, label: transition.label })),
            tickets: [],
          };
          groups.set(key, group);
        }
        group.tickets.push({
          id: row.id,
          number: row.number.toString(),
          title: row.title,
          visitId: row.visitId,
          requester: { id: row.requester.id, name: `${row.requester.firstName} ${row.requester.lastName}`.trim() },
          companyName: row.companyName,
          createdAt: row.createdAt.toISOString(),
          dueAt: row.dueAt?.toISOString() ?? null,
          values: Object.fromEntries([...group.shownFields, ...(group.groupField === null ? [] : [group.groupField])].flatMap((field) => (row.values[field.code] === undefined ? [] : [[field.code, row.values[field.code]]]))),
          subgroup: batchSubgroupOf(group, row),
        });
      }
      return [...groups.values()];
    });
  }

  /** The tickets moved share a batch id, so a RANDOM_DISPATCH step they reach hands them to one person. */
  async transition(actor: TicketActor, request: BatchTransitionRequest): Promise<BatchTransitionResponse> {
    const refusals = await this.refusals(actor, request);
    const batchId = randomUUID();
    const results: BatchTransitionResult[] = [];
    for (const item of request.items) {
      const refused = refusals.get(item.ticketId);
      if (refused !== undefined) {
        results.push({ ticketId: item.ticketId, ok: false, error: { code: refused.code, message: refused.message } });
        continue;
      }
      try {
        const ticket = await this.transitions.transition(actor, item.ticketId, {
          transitionId: request.transitionId,
          visitId: item.visitId,
          values: request.values,
          attachments: [],
          ...(request.comment === undefined ? {} : { comment: request.comment }),
        }, batchId);
        results.push({ ticketId: item.ticketId, ok: true, ticket });
      } catch (error) {
        if (!(error instanceof DomainError)) this.logger.error(error, 'TicketBatchService');
        const known = error instanceof DomainError ? error : undefined;
        results.push({ ticketId: item.ticketId, ok: false, error: { code: known?.code ?? 'INTERNAL_ERROR', message: known?.message ?? 'The ticket could not be moved' } });
      }
    }
    return { results };
  }

  /** What stops each ticket before its transition is tried, read in one transaction without locking. */
  private refusals(actor: TicketActor, request: BatchTransitionRequest): Promise<Map<string, DomainError>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const found = [];
      for (const item of request.items) {
        const ticket = await this.writes.findTicket(tx, tenantId, item.ticketId);
        const assignees = ticket === undefined ? [] : await this.writes.findAssignees(tx, tenantId, ticket.id);
        const own = assignees.find((assignee) => assignee.userId === actor.userId);
        const visible = ticket !== undefined && (own !== undefined || (await actor.canRead(tx, ticket.id)));
        const document = ticket === undefined || !visible ? undefined : await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
        found.push({ item, ticket: visible ? ticket : undefined, step: document?.steps.find((step) => step.id === ticket?.currentStepId), ownType: own?.type });
      }
      const perStep = new Map<string, number>();
      for (const { step } of found) if (step !== undefined) perStep.set(step.id, (perStep.get(step.id) ?? 0) + 1);

      const refusals = new Map<string, DomainError>();
      for (const { item, ticket, step, ownType } of found) {
        const refusal =
          ticket === undefined ? new NotFoundError() : batchRefusal({ status: ticket.status, step, ownType, sameStepCount: step === undefined ? 0 : (perStep.get(step.id) ?? 0) });
        if (refusal !== null) refusals.set(item.ticketId, refusal);
      }
      return refusals;
    });
  }
}
