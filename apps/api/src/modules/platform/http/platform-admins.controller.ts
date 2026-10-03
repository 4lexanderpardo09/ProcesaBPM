import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type InvitePlatformAdminRequest, invitePlatformAdminRequestSchema, type PlatformAdminSummary } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PlatformAdminsService } from '../application/platform-admins.service.js';

@PlatformAdminOnly()
@Controller('platform/admins')
export class PlatformAdminsController {
  constructor(@Inject(PlatformAdminsService) private readonly admins: PlatformAdminsService) {}

  @Get()
  list(): Promise<PlatformAdminSummary[]> {
    return this.admins.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  invite(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Body(new ZodValidationPipe(invitePlatformAdminRequestSchema)) body: InvitePlatformAdminRequest,
  ): Promise<PlatformAdminSummary> {
    return this.admins.invite(admin.userId, body);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.admins.revoke(admin.userId, userId);
  }
}
