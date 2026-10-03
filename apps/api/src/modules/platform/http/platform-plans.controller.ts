import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { type PlanSummary, type UpdatePlanRequest, updatePlanRequestSchema } from '@procesabpm/shared';
import { CurrentPlatformPrincipal, type PlatformPrincipal } from '../../../common/auth/principal.js';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PlanAdminService } from '../application/plan-admin.service.js';

@PlatformAdminOnly()
@Controller('platform/plans')
export class PlatformPlansController {
  constructor(@Inject(PlanAdminService) private readonly plans: PlanAdminService) {}

  @Get()
  list(): Promise<PlanSummary[]> {
    return this.plans.list();
  }

  @Put(':code')
  update(
    @CurrentPlatformPrincipal() admin: PlatformPrincipal,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updatePlanRequestSchema)) body: UpdatePlanRequest,
  ): Promise<PlanSummary> {
    return this.plans.update(admin.userId, code, body);
  }
}
