import { Inject, Injectable } from '@nestjs/common';
import { captureFieldsFor, type CreationFormResponse, InitiatorNotAllowedError, InvalidReferenceError, NotFoundError, PermissionDeniedError, WorkflowNotAvailableError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { formFieldsOf } from '../domain/form-fields.js';
import type { TicketCreator } from './create-ticket.service.js';
import { assertRunnable, CreationGate } from './creation-gate.js';

/**
 * The creation form of a subcategory for the caller: the same checks as creating the ticket (available subcategory,
 * published and runnable version, permission for that record, initiators), answered with the same errors.
 */
@Injectable()
export class CreationFormService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(CreationGate) private readonly gate: CreationGate,
  ) {}

  form(actor: TicketCreator, subcategoryId: string, companyId: string | undefined): Promise<CreationFormResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const requester = await this.people.findActiveMember(tx, tenantId, actor.userId);
      if (requester === null) throw new InvalidReferenceError('The requester is not an active member');
      const company = await this.gate.companyOf(tx, tenantId, requester, companyId);
      const subcategory = await this.people.findAvailableSubcategory(tx, tenantId, subcategoryId, company.id, requester.departmentId);
      if (subcategory === null) throw new NotFoundError();
      const published = await this.versions.findForSubcategory(tx, tenantId, subcategoryId);
      if (published === null) throw new WorkflowNotAvailableError();
      assertRunnable(published.document);
      const record = { companyId: company.id, departmentId: requester.departmentId, siteId: requester.siteId, subcategoryId, workflowId: published.workflowId, priorityId: subcategory.defaultPriorityId, creatorId: requester.userId };
      if (!actor.mayCreate('create', record)) throw new PermissionDeniedError('Not allowed to create tickets for this person');
      const starts = await this.gate.allowedStarts(tx, tenantId, published.document.steps.filter((step) => step.type === 'START'), requester, company);
      if (starts.length === 0) throw new InitiatorNotAllowedError();
      return {
        subcategoryId,
        workflowId: published.workflowId,
        versionId: published.versionId,
        companyId: company.id,
        defaultPriorityId: subcategory.defaultPriorityId,
        starts: starts.map((start) => ({ stepId: start.id, name: start.name, description: start.description, fields: formFieldsOf(captureFieldsFor(published.document.fields, 'CREATION', start.id)) })),
      };
    });
  }
}
