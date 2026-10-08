import { Module } from '@nestjs/common';
import { TicketAccessModule } from '../tickets/ticket-access.module.js';
import { DashboardService } from './application/dashboard.service.js';
import { DashboardRepository } from './data/dashboard.repository.js';
import { DashboardController } from './http/dashboard.controller.js';

/** The member's overview: counters and their pending tickets. API only. */
@Module({
  imports: [TicketAccessModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
})
export class DashboardModule {}
