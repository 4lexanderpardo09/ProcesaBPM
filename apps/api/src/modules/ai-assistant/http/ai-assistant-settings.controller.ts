import { Body, Controller, Get, Inject, Put, Query } from '@nestjs/common';
import { type AiAssistantSettingsResponse, type AiUsageQuery, aiUsageQuerySchema, type AiUsageResponse, type UpdateAiAssistantSettings, updateAiAssistantSettingsSchema } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AiSettingsService } from '../application/ai-settings.service.js';

@Controller('settings/ai-assistant')
export class AiAssistantSettingsController {
  constructor(@Inject(AiSettingsService) private readonly settings: AiSettingsService) {}

  @Get()
  @RequirePermission('update', 'Setting')
  get(@CurrentPrincipal() principal: Principal): Promise<AiAssistantSettingsResponse> {
    return this.settings.get(principal);
  }

  @Put()
  @Audited('tenant.ai_assistant_updated')
  @RequirePermission('update', 'Setting')
  update(@CurrentPrincipal() principal: Principal, @Body(new ZodValidationPipe(updateAiAssistantSettingsSchema)) body: UpdateAiAssistantSettings): Promise<AiAssistantSettingsResponse> {
    return this.settings.update(principal, body);
  }

  @Get('usage')
  @RequirePermission('update', 'Setting')
  usage(@CurrentPrincipal() principal: Principal, @Query(new ZodValidationPipe(aiUsageQuerySchema)) query: AiUsageQuery): Promise<AiUsageResponse> {
    return this.settings.usage(principal, query);
  }
}
