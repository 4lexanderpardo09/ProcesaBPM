import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  type ChangeTenantPlanRequest,
  changeTenantPlanRequestSchema,
  type CreateTenantRequest,
  type CreateTenantResponse,
  createTenantRequestSchema,
  type ListTenantsQuery,
  listTenantsQuerySchema,
  type Page,
  type ReactivateTenantRequest,
  reactivateTenantRequestSchema,
  type SetExtraStorageRequest,
  setExtraStorageRequestSchema,
  type SuspendTenantRequest,
  suspendTenantRequestSchema,
  type TenantDetail,
  type TenantListItem,
  type TenantStatusResponse,
} from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TenantAdminService } from '../application/tenant-admin.service.js';
import { TenantSignupService } from '../application/tenant-signup.service.js';
import { TenantStatusService } from '../application/tenant-status.service.js';

@PlatformAdminOnly()
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(
    @Inject(TenantSignupService) private readonly signup: TenantSignupService,
    @Inject(TenantStatusService) private readonly status: TenantStatusService,
    @Inject(TenantAdminService) private readonly tenants: TenantAdminService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(listTenantsQuerySchema)) query: ListTenantsQuery): Promise<Page<TenantListItem>> {
    return this.tenants.list(query);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<TenantDetail> {
    return this.tenants.detail(id);
  }

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
  suspend(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(suspendTenantRequestSchema)) body: SuspendTenantRequest,
  ): Promise<TenantStatusResponse> {
    return this.status.suspend(admin.userId, id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reactivateTenantRequestSchema)) body: ReactivateTenantRequest,
  ): Promise<TenantStatusResponse> {
    return this.status.reactivate(admin.userId, id, body.reason);
  }

  @Put(':id/plan')
  changePlan(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeTenantPlanRequestSchema)) body: ChangeTenantPlanRequest,
  ): Promise<TenantDetail> {
    return this.tenants.changePlan(admin.userId, id, body);
  }

  @Put(':id/extra-storage')
  setExtraStorage(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setExtraStorageRequestSchema)) body: SetExtraStorageRequest,
  ): Promise<TenantDetail> {
    return this.tenants.setExtraStorage(admin.userId, id, body);
  }

  @Post(':id/owner-invitation')
  @HttpCode(HttpStatus.NO_CONTENT)
  resendOwnerInvitation(@CurrentPlatformPrincipal() admin: PlatformPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tenants.resendOwnerInvitation(admin.userId, id);
  }
}
