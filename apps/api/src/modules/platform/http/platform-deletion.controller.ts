import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type RequestTenantDeletion, requestTenantDeletionSchema, type TenantDeletionResponse } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TenantDeletionService } from '../application/tenant-deletion.service.js';

@PlatformAdminOnly()
@Controller('platform/tenants/:id/deletion')
export class PlatformDeletionController {
  constructor(@Inject(TenantDeletionService) private readonly deletion: TenantDeletionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  request(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body(new ZodValidationPipe(requestTenantDeletionSchema)) body: RequestTenantDeletion,
  ): Promise<TenantDeletionResponse> {
    return this.deletion.request(admin.userId, tenantId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) tenantId: string): Promise<TenantDeletionResponse> {
    return this.deletion.cancel(admin.userId, tenantId);
  }
}
