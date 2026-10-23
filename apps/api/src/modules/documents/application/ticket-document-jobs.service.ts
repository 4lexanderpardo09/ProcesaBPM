import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, NotFoundError, PermissionDeniedError, type TicketDocumentJobsResponse, type TicketDocumentJobState } from '@procesabpm/shared';
import type { OutboxStatus } from '@procesabpm/db';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { accessibleWhere } from '../../authorization/domain/record-access.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { TicketQueryRepository } from '../../tickets/data/ticket-query.repository.js';
import { readableTickets } from '../../tickets/application/ticket-access.js';
import { TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { DocumentOutboxRepository } from '../data/document-outbox.repository.js';
import { type JobTicket, type LastJob, TicketDocumentJobsRepository, type WorkflowDocumentChoice } from '../data/ticket-document-jobs.repository.js';
import { type DocumentGeneratePayload, documentGeneratePayloadSchema } from './document-generate.payload.js';

const STATE: Readonly<Record<OutboxStatus, TicketDocumentJobState | null>> = { PENDING: 'GENERATING', PROCESSING: 'GENERATING', FAILED: 'FAILED', DONE: null };

interface Offered {
  readonly document: WorkflowDocumentChoice;
  readonly job: LastJob | undefined;
}

/**
 * Where the drawing of a ticket's documents stands, and asking for one again (the data changed, or it failed). Reading
 * follows the ticket's read access; asking again needs `update` on this ticket. Drawing stays the worker's job: asking
 * only queues one more `document.generate` event, which makes a new version.
 */
@Injectable()
export class TicketDocumentJobsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
    @Inject(TicketDocumentJobsRepository) private readonly jobs: TicketDocumentJobsRepository,
    @Inject(DocumentOutboxRepository) private readonly outbox: DocumentOutboxRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  status(ability: AppAbility, ticketId: string): Promise<TicketDocumentJobsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const ticket = await this.readableTicket(tx, tenantId, ability, ticketId);
      return this.describe(tx, tenantId, ability, ticketId, ticket);
    });
  }

  regenerate(ability: AppAbility, ticketId: string, workflowDocumentId: string): Promise<TicketDocumentJobsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const ticket = await this.readableTicket(tx, tenantId, ability, ticketId);
      if (!(await this.mayRegenerate(tx, tenantId, ability, ticketId))) throw new PermissionDeniedError('Drawing a document again needs update on the ticket');
      const chosen = (await this.offered(tx, tenantId, ticketId, ticket)).find((entry) => entry.document.id === workflowDocumentId);
      if (chosen === undefined || !chosen.document.usable || ticket.lastEventId === null) throw new NotFoundError();
      // Asking twice while it is being drawn would draw the same thing twice.
      if (chosen.job !== undefined && STATE[chosen.job.status] === 'GENERATING') throw new InvalidStateError('The document is already being drawn');
      // Drawn where it was drawn last time (a block's step document stays one); otherwise as the ticket's main document.
      const previous = documentGeneratePayloadSchema.safeParse(chosen.job?.payload);
      const placement = previous.success ? { role: previous.data.role, stepId: previous.data.stepId } : { role: 'MAIN_DOCUMENT' as const, stepId: null };
      const payload: DocumentGeneratePayload = { ticketId, ticketEventId: ticket.lastEventId, workflowDocumentId, ...placement, trigger: 'MANUAL' };
      await this.outbox.enqueue(tx, tenantId, [payload]);
      await this.audit.record(tx, { action: 'ticket.document_regenerated', subjectType: 'Ticket', subjectId: ticketId, after: { workflowDocumentId, name: chosen.document.name } });
      return this.describe(tx, tenantId, ability, ticketId, ticket);
    });
  }

  private async readableTicket(tx: TenantTransaction, tenantId: string, ability: AppAbility, ticketId: string): Promise<JobTicket> {
    const ticket = (await this.tickets.isAccessible(tx, tenantId, ticketId, readableTickets(ability))) ? await this.jobs.ticket(tx, tenantId, ticketId) : null;
    if (ticket === null) throw new NotFoundError();
    return ticket;
  }

  private mayRegenerate(tx: TenantTransaction, tenantId: string, ability: AppAbility, ticketId: string): Promise<boolean> {
    return this.tickets.isAccessible(tx, tenantId, ticketId, accessibleWhere(ability, 'update', TICKET_SUBJECT));
  }

  private async describe(tx: TenantTransaction, tenantId: string, ability: AppAbility, ticketId: string, ticket: JobTicket): Promise<TicketDocumentJobsResponse> {
    const offered = await this.offered(tx, tenantId, ticketId, ticket);
    return {
      canRegenerate: await this.mayRegenerate(tx, tenantId, ability, ticketId),
      documents: offered.map(({ document, job }) => ({
        workflowDocumentId: document.id,
        name: document.name,
        state: job === undefined ? null : STATE[job.status],
        requestedAt: job?.createdAt.toISOString() ?? null,
      })),
    };
  }

  /**
   * The documents of the ticket: the ones its workflow draws at a moment for its company (the company's own one wins over
   * the general one, as when they are drawn), and any other it was asked to draw (a DOCUMENT block). One that only a block
   * draws and was never asked for is not the ticket's yet.
   */
  private async offered(tx: TenantTransaction, tenantId: string, ticketId: string, ticket: JobTicket): Promise<Offered[]> {
    const [documents, jobs] = await Promise.all([this.jobs.workflowDocuments(tx, tenantId, ticket.workflowId), this.jobs.lastJobs(tx, tenantId, ticketId)]);
    const jobOf = new Map(jobs.map((job) => [job.workflowDocumentId, job]));
    const forCompany = documents.filter((document) => document.companyId === null || document.companyId === ticket.companyId);
    const ownMoments = new Set(forCompany.filter((document) => document.usable && document.companyId !== null).map((document) => document.moment));
    const drawnAtMoment = (document: WorkflowDocumentChoice) => document.usable && document.moment !== null && (document.companyId !== null || !ownMoments.has(document.moment));
    return forCompany.map((document) => ({ document, job: jobOf.get(document.id) })).filter(({ document, job }) => job !== undefined || drawnAtMoment(document));
  }
}
