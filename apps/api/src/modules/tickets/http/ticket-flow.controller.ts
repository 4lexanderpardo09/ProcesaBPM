import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import type { TicketFlowResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { TicketFlowService } from '../application/ticket-flow.service.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../domain/ticket-subject.js';

@Controller('tickets')
export class TicketFlowController {
  constructor(@Inject(TicketFlowService) private readonly flows: TicketFlowService) {}

  /** The graph of the ticket's workflow version and how far the ticket got, for the "progress" diagram. Reading the ticket is enough. */
  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get(':id/flow')
  flow(@CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string): Promise<TicketFlowResponse> {
    return this.flows.flow(ability, id);
  }
}
