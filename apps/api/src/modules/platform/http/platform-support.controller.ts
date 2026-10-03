import { Controller, Delete, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { SupportSessionResponse } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { SupportSessionService } from '../application/support-session.service.js';

@PlatformAdminOnly()
@Controller('platform/tenants/:id/support-sessions')
export class PlatformSupportController {
  constructor(@Inject(SupportSessionService) private readonly support: SupportSessionService) {}

  /** 403 `SUPPORT_ACCESS_NOT_GRANTED` unless the tenant has a grant in force. Open it again to renew the token. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  open(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) tenantId: string): Promise<SupportSessionResponse> {
    return this.support.open(admin, tenantId);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  close(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    return this.support.close(admin.userId, tenantId, sessionId);
  }
}
