import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type AttachTagRequest, attachTagRequestSchema, type TagResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { TicketTagsService } from '../application/ticket-tags.service.js';

/** The caller's own tags on a ticket. Reading the ticket is the authorization (checked against the record). */
@Controller('tickets/:ticketId/tags')
export class TicketTagsController {
  constructor(@Inject(TicketTagsService) private readonly tags: TicketTagsService) {}

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get()
  list(@CurrentAbility() ability: AppAbility, @Param('ticketId', ParseUUIDPipe) ticketId: string): Promise<TagResponse[]> {
    return this.tags.list(ability, ticketId);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Post()
  attach(@CurrentAbility() ability: AppAbility, @Param('ticketId', ParseUUIDPipe) ticketId: string, @Body(new ZodValidationPipe(attachTagRequestSchema)) body: AttachTagRequest): Promise<void> {
    return this.tags.attach(ability, ticketId, body);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  detach(@CurrentAbility() ability: AppAbility, @Param('ticketId', ParseUUIDPipe) ticketId: string, @Param('tagId', ParseUUIDPipe) tagId: string): Promise<void> {
    return this.tags.detach(ability, ticketId, tagId);
  }
}
