import { Inject, Injectable } from '@nestjs/common';
import { type CloseTicketRequest, InvalidStateError, type TicketMutationResponse } from '@procesabpm/shared';
import { sanitizeOptionalRichText } from '../../../infrastructure/text/rich-text.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { EventPlan } from '../domain/plan.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { assertMayClose } from '../domain/close-policy.js';
import { attachmentsPlanOf } from './submission-files.js';
import { diversionEdge, SubmissionValidator } from './submission-validator.js';
import { TicketMutationApplier } from './ticket-mutation-applier.js';
import { TicketSlaService } from './ticket-sla.service.js';

/** Closes a ticket from a step whose `close_rule` allows it, finishing its visit and clocks. */
@Injectable()
export class CloseTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(SubmissionValidator) private readonly submissions: SubmissionValidator,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
    @Inject(TicketMutationApplier) private readonly applier: TicketMutationApplier,
  ) {}

  close(actor: TicketActor, ticketId: string, request: CloseTicketRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const current = await this.loader.load(tx, tenantId, ticketId, request.visitId, actor);
      await this.loader.assertMayAct(tx, current, actor, 'close');
      await this.loader.takeImplicitly(tx, tenantId, current, actor.userId);
      const { ticket, visit } = current;

      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const step = document.steps.find((candidate) => candidate.id === ticket.currentStepId);
      if (step === undefined) throw new InvalidStateError('The ticket is not on a step of its version');

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const actorMember = await this.people.findActiveMember(tx, tenantId, actor.userId);
      const submission = await this.submissions.validate(tx, {
        tenantId,
        document,
        stage: 'STEP',
        step,
        input: request.values,
        existing: await this.loader.valuesOf(tx, tenantId, ticket.id, document),
        company,
        positionId: actorMember?.positionId ?? null,
        at,
        uploaderId: actor.userId,
        attachmentIds: request.attachments,
      });
      const diversion = diversionEdge(document, submission.amounts, step.id);
      assertMayClose(step, diversion !== undefined && !(await this.writes.hasVisited(tx, tenantId, ticket.id, diversion.toStepId)));
      const closing = await this.sla.closeVisit(tx, tenantId, ticket.id, company, visit, current.clocks, at, null);
      const events: EventPlan[] = [
        ...(submission.changes.length === 0 ? [] : [{ type: 'FIELDS_UPDATED', stepId: step.id, loop: visit.loop, actorId: actor.userId, data: { changes: submission.changes } } satisfies EventPlan]),
        ...submission.amounts.warnings.map((warning): EventPlan => ({ type: 'AMOUNT_WARNING', stepId: step.id, loop: visit.loop, actorId: actor.userId, data: { ...warning } })),
        {
          type: 'CLOSED',
          stepId: step.id,
          loop: visit.loop,
          actorId: actor.userId,
          commentHtml: sanitizeOptionalRichText(request.comment),
          attachments: attachmentsPlanOf(submission.files, step.id, 'CLOSING'),
          data: { reason: 'CLOSED_BY_USER' },
          outbox: [{ type: 'ticket.closed', payload: { closedById: actor.userId } }],
        },
      ];
      await this.applier.apply(tx, tenantId, { id: ticket.id, workflowVersionId: ticket.workflowVersionId, companyId: ticket.companyId }, { at, actorId: actor.userId, fieldWrites: submission.fieldWrites, closing, ticket: { kind: 'closed', stepId: null }, events });
      return { id: ticket.id, number: ticket.number.toString(), status: 'CLOSED', currentStepId: step.id, openVisitId: null };
    });
  }
}
