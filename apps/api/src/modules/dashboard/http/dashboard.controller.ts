import { Controller, Get, Inject } from '@nestjs/common';
import type { DashboardStatsResponse, PendingTicketResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { DashboardService } from '../application/dashboard.service.js';

/** The member's own overview. Reading tickets is the authorization; the queries stay within what they may read. */
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get('stats')
  stats(@CurrentAbility() ability: AppAbility): Promise<DashboardStatsResponse> {
    return this.dashboard.stats(ability);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get('pending')
  pending(@CurrentAbility() ability: AppAbility): Promise<PendingTicketResponse[]> {
    return this.dashboard.pending(ability);
  }
}
