import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type CreateTenantRequest,
  type CreateTenantResponse,
  createTenantRequestSchema,
  type TenantStatusResponse,
} from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TenantSignupService } from '../application/tenant-signup.service.js';
import { TenantStatusService } from '../application/tenant-status.service.js';

@PlatformAdminOnly()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(
    @Inject(TenantSignupService) private readonly signup: TenantSignupService,
    @Inject(TenantStatusService) private readonly status: TenantStatusService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Body(new ZodValidationPipe(createTenantRequestSchema)) body: CreateTenantRequest,
  ): Promise<CreateTenantResponse> {
    return this.signup.signUp(admin.userId, body);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<TenantStatusResponse> {
    return this.status.suspend(admin.userId, id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<TenantStatusResponse> {
    return this.status.reactivate(admin.userId, id);
  }
}
