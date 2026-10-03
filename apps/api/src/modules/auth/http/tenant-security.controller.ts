import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { tenantSecuritySettingsSchema, type TenantSecuritySettings, type TenantSecuritySettingsResponse } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TenantSecurityService } from '../application/tenant-security.service.js';

@Controller('settings/security')
export class TenantSecurityController {
  constructor(@Inject(TenantSecurityService) private readonly security: TenantSecurityService) {}

  @Get()
  @RequirePermission('update', 'Setting')
  get(@CurrentPrincipal() principal: Principal): Promise<TenantSecuritySettingsResponse> {
    return this.security.get(principal);
  }

  @Put()
  @Audited('tenant.security_policy_updated')
  @RequirePermission('update', 'Setting')
  update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(tenantSecuritySettingsSchema)) body: TenantSecuritySettings,
  ): Promise<TenantSecuritySettingsResponse> {
    return this.security.update(principal, body);
  }
}
