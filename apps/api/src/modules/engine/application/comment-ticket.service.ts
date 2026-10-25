import { Inject, Injectable } from '@nestjs/common';
import { CommentRequiredError, type CommentTicketRequest, type CommentTicketResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { commentRefusal } from '../domain/ticket-action-rules.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { SubmissionFilesChecker } from './submission-files.js';

/**
 * A comment on a ticket, with files if the person attaches any. It does not move the ticket. As in the help desk, a
 * closed ticket takes no more comments (422 `TICKET_NOT_OPEN`; reopen it instead); a paused one does. The caller must
 * be able to see the ticket and hold the `comment` permission for this very ticket. The row is locked like for any
 * other action on a ticket, so a comment racing a close is decided after it.
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
      const refusal = commentRefusal(await actor.can(tx, ticket.id, 'comment'), ticket.status);
      if (refusal !== null) throw refusal;
      const commentHtml = sanitizeRichText(request.comment);
      if (commentHtml === '') throw new CommentRequiredError();

      const { files } = await this.fileChecker.check(tx, { tenantId, uploaderId: actor.userId, attachmentIds: request.attachments, fileFields: [], capturedValues: {}, existing: {}, references: [] });
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
