import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import {
  type GrantSupportAccessRequest,
  grantSupportAccessRequestSchema,
  type SupportAccessResponse,
  type SupportGrantResponse,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { SupportAccessService } from '../application/support-access.service.js';

/** The tenant's door for platform support: open it for a few hours, close it, and see who came in. */
@Controller('settings/support-access')
export class SupportAccessController {
  constructor(@Inject(SupportAccessService) private readonly support: SupportAccessService) {}

  @Get()
  @RequirePermission('manage', 'SupportAccess')
  get(@CurrentPrincipal() principal: Principal): Promise<SupportAccessResponse> {
    return this.support.get(principal);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Audited('support_access.granted')
  @RequirePermission('manage', 'SupportAccess')
  grant(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(grantSupportAccessRequestSchema)) body: GrantSupportAccessRequest,
  ): Promise<SupportGrantResponse> {
    return this.support.grant(principal, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited('support_access.revoked')
  @RequirePermission('manage', 'SupportAccess')
  revoke(@CurrentPrincipal() principal: Principal): Promise<void> {
    return this.support.revoke(principal);
  }
}
