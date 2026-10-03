import { Controller, Get, Inject } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { AnnouncementsService } from '../application/announcements.service.js';

/** Every signed-in member sees the platform's notices: no catalog permission applies. */
@AuthenticatedOnly()
@Controller('announcements')
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcements: AnnouncementsService) {}

  @Get()
  listActive(): Promise<AnnouncementResponse[]> {
    return this.announcements.listActive();
  }
}
