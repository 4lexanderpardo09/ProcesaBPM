import { Inject, Injectable } from '@nestjs/common';
import { CommentRequiredError, type CommentTicketRequest, type CommentTicketResponse, PermissionDeniedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { SubmissionFilesChecker } from './submission-files.js';

/**
 * A comment on a ticket, with files if the person attaches any. It does not move the ticket and is allowed in
 * any status (people keep talking after a ticket is closed), but the caller must be able to see the ticket and
 * hold the `comment` permission for this very ticket. The row is locked like for any other action on a ticket.
 */
@Injectable()
export class CommentTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(SubmissionFilesChecker) private readonly fileChecker: SubmissionFilesChecker,
    @Inject(FileAttachmentService) private readonly files: FileAttachmentService,
  ) {}

  comment(actor: TicketActor, ticketId: string, request: CommentTicketRequest): Promise<CommentTicketResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const { ticket } = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      if (!(await actor.can(tx, ticket.id, 'comment'))) throw new PermissionDeniedError('Not allowed to comment on this ticket');
      const commentHtml = sanitizeRichText(request.comment);
      if (commentHtml === '') throw new CommentRequiredError();

      const { files } = await this.fileChecker.check(tx, { tenantId, uploaderId: actor.userId, attachmentIds: request.attachments, fileFieldCodes: [], capturedValues: {}, existing: {}, references: [] });
      const eventId = await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
        type: 'COMMENTED',
        stepId: ticket.currentStepId,
        loop: ticket.currentLoop,
        actorId: actor.userId,
        commentHtml,
        outbox: [{ type: 'ticket.commented', payload: { actorId: actor.userId } }],
      });
      if (files.attachmentIds.length > 0) {
        await this.files.link(tx, tenantId, { ticketId: ticket.id, companyId: ticket.companyId, stepId: ticket.currentStepId, eventId, at, attachmentIds: files.attachmentIds, attachmentRole: 'ATTACHMENT', fieldFiles: [] });
      }
      return { eventId };
    });
  }
}
