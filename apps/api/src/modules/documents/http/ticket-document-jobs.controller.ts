import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type RegenerateTicketDocumentRequest, regenerateTicketDocumentRequestSchema, type TicketDocumentJobsResponse } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequireAnyPermission, RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { TicketDocumentJobsService } from '../application/ticket-document-jobs.service.js';

/** The ticket's documents being drawn or failed, and drawing one again. */
@Controller('tickets/:ticketId/document-jobs')
export class TicketDocumentJobsController {
  constructor(@Inject(TicketDocumentJobsService) private readonly jobs: TicketDocumentJobsService) {}

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get()
  status(@CurrentAbility() ability: AppAbility, @Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<TicketDocumentJobsResponse> {
    return this.jobs.status(ability, ticketId);
  }

  @RequirePermission('update', TICKET_SUBJECT)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Audited('ticket.document_regenerated')
  regenerate(@CurrentAbility() ability: AppAbility, @Param('ticketId', ParseUUIDPipe) ticketId: string, @Body(new ZodValidationPipe(regenerateTicketDocumentRequestSchema)) body: RegenerateTicketDocumentRequest): Promise<TicketDocumentJobsResponse> {
    return this.jobs.regenerate(ability, ticketId, body.workflowDocumentId);
  }
}
