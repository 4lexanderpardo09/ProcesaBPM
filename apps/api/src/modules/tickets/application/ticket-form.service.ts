import { Inject, Injectable } from '@nestjs/common';
import { captureFieldsFor, type TicketFormResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { formFieldsOf } from '../../engine/domain/form-fields.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketQueriesService } from './ticket-queries.service.js';

/**
 * The form of a ticket's current step, for whoever may read the ticket. Showing it is not permission to act: advancing
 * still needs to be on the step and goes through the engine, which applies the same field and decision rules.
 */
@Injectable()
export class TicketFormService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketQueriesService) private readonly queries: TicketQueriesService,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
  ) {}

  async form(ability: AppAbility, ticketId: string, userId: string): Promise<TicketFormResponse> {
    // Reading the ticket decides the 404 (per-record authorization), exactly as `GET /tickets/:id`.
    const ticket = await this.queries.get(ability, ticketId, userId);
    const document = await this.runner.withTenantTransaction((tx) => this.versions.documentOf(tx, this.context.require().tenantId, ticket.workflowVersionId));
    const visit = ticket.status === 'CLOSED' ? null : ticket.openVisit;
    const step = visit === null ? undefined : document.steps.find((candidate) => candidate.id === visit.stepId);
    return {
      ticketId: ticket.id,
      versionId: ticket.workflowVersionId,
      visitId: visit?.id ?? null,
      step: step === undefined ? null : { id: step.id, name: step.name, type: step.type, description: step.description, closeRule: step.closeRule },
      fields: formFieldsOf(document.fields),
      editableFieldCodes: step === undefined ? [] : captureFieldsFor(document.fields, 'STEP', step.id).map((field) => field.code),
      decisions:
        step === undefined
          ? []
          : document.transitions
              .filter((transition) => transition.fromStepId === step.id && transition.type === 'DECISION')
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((transition) => ({ transitionId: transition.id, label: transition.label })),
    };
  }
}
