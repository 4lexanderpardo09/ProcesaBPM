import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { type BatchTransitionRequest, batchTransitionRequestSchema, type BatchTransitionResponse, type TicketBatchGroup } from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { TicketBatchService } from '../../engine/application/ticket-batch.service.js';
import { TicketQueriesService } from '../application/ticket-queries.service.js';
import { TICKET_SUBJECT } from '../domain/ticket-subject.js';

/** "Procesar en lote": the tickets the caller holds on batch steps, and one decision for several of them. */
@Controller('ticket-batches')
export class TicketBatchesController {
  constructor(
    @Inject(TicketBatchService) private readonly batches: TicketBatchService,
    @Inject(TicketQueriesService) private readonly queries: TicketQueriesService,
  ) {}

  @RequirePermission('transition', TICKET_SUBJECT)
  @Get()
  groups(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility): Promise<TicketBatchGroup[]> {
    return this.batches.groups(this.queries.actorFor(principal, ability));
  }

  @RequirePermission('transition', TICKET_SUBJECT)
  @Post('transition')
  @HttpCode(HttpStatus.OK)
  transition(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Body(new ZodValidationPipe(batchTransitionRequestSchema)) body: BatchTransitionRequest): Promise<BatchTransitionResponse> {
    return this.batches.transition(this.queries.actorFor(principal, ability), body);
  }
}
