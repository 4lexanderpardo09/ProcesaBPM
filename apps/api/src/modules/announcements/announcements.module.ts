import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/auth/rate-limit.js';
import { AuthModule } from '../auth/auth.module.js';
import { AnnouncementsService } from './application/announcements.service.js';
import { ActiveAnnouncementRepository } from './data/active-announcement.repository.js';
import { AnnouncementsController } from './http/announcements.controller.js';
import { PublicAnnouncementsController } from './http/public-announcements.controller.js';

/** What members see of the platform's announcements (the ones in force for their organization), and the public banner. */
@Module({
  imports: [AuthModule],
  controllers: [PublicAnnouncementsController, AnnouncementsController],
  providers: [ActiveAnnouncementRepository, AnnouncementsService, RateLimitGuard],
})
export class AnnouncementsModule {}
