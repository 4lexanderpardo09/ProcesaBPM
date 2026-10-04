import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import type { AnnouncementResponse } from '@procesabpm/shared';
import { Public } from '../../../common/auth/public.decorator.js';
import { RateLimit, RateLimitGuard, type RateLimitPolicy } from '../../../common/auth/rate-limit.js';
import { AnnouncementsService } from '../application/announcements.service.js';

const MINUTE = 60_000;
const PUBLIC_ANNOUNCEMENTS_RATE_LIMIT: RateLimitPolicy = { name: 'announcements-login', perIp: { limit: 60, windowMs: MINUTE }, perIdentifier: { limit: 60, windowMs: MINUTE } };

/** The sign-in page shows the notices for everybody (a maintenance window) before anyone signs in. */
@Controller('announcements')
export class PublicAnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcements: AnnouncementsService) {}

  /** Targeted announcements are never listed here: they would tell which organizations are affected. */
  @Public()
  @Get('login')
  @Header('Cache-Control', 'public, max-age=30')
  @RateLimit(PUBLIC_ANNOUNCEMENTS_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  listForSignIn(): Promise<AnnouncementResponse[]> {
    return this.announcements.listPublic();
  }
}
