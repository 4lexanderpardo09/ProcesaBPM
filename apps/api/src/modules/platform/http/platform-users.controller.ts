import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type MfaResetRequest,
  mfaResetRequestSchema,
  type MfaResetResponse,
  type PlatformUserLookupQuery,
  platformUserLookupQuerySchema,
  type PlatformUserResponse,
} from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PlatformUserSupportService } from '../application/platform-user-support.service.js';

@PlatformAdminOnly()
@Controller('platform/users')
export class PlatformUsersController {
  constructor(@Inject(PlatformUserSupportService) private readonly support: PlatformUserSupportService) {}

  /** Exact e-mail only; 404 when there is no such account. 30 per hour per administrator. */
  @Get()
  lookup(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Query(new ZodValidationPipe(platformUserLookupQuerySchema)) query: PlatformUserLookupQuery): Promise<PlatformUserResponse> {
    return this.support.lookup(admin.userId, query.email);
  }

  /**
   * 404 unknown user, 409 `MFA_NOT_ENABLED`, 422 `INVALID_STATE` (one's own factor, or a requester who does not administer
   * an organization of the user). 10 per hour per administrator and 3 per day per user.
   */
  @Post(':userId/mfa-reset')
  @HttpCode(HttpStatus.OK)
  resetMfa(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(mfaResetRequestSchema)) body: MfaResetRequest,
  ): Promise<MfaResetResponse> {
    return this.support.resetMfa(admin.userId, userId, body);
  }
}
