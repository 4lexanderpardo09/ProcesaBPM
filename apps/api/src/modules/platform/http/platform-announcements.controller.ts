import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { type AnnouncementRequest, announcementRequestSchema, type AnnouncementResponse } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AnnouncementAdminService } from '../application/announcement-admin.service.js';

@PlatformAdminOnly()
@Controller('platform/announcements')
export class PlatformAnnouncementsController {
  constructor(@Inject(AnnouncementAdminService) private readonly announcements: AnnouncementAdminService) {}

  @Get()
  list(): Promise<AnnouncementResponse[]> {
    return this.announcements.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Body(new ZodValidationPipe(announcementRequestSchema)) body: AnnouncementRequest): Promise<AnnouncementResponse> {
    return this.announcements.create(admin.userId, body);
  }

  @Put(':id')
  update(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(announcementRequestSchema)) body: AnnouncementRequest,
  ): Promise<AnnouncementResponse> {
    return this.announcements.update(admin.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.announcements.delete(admin.userId, id);
  }
}
