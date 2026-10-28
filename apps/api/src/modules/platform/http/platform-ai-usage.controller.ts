import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type PlatformAiUsageQuery, platformAiUsageQuerySchema, type PlatformAiUsageResponse } from '@procesabpm/shared';
import { PlatformAdminOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { AiUsageService } from '../application/ai-usage.service.js';

@PlatformAdminOnly()
@Controller('platform/ai-usage')
export class PlatformAiUsageController {
  constructor(@Inject(AiUsageService) private readonly usage: AiUsageService) {}

  @Get()
  report(@Query(new ZodValidationPipe(platformAiUsageQuerySchema)) query: PlatformAiUsageQuery): Promise<PlatformAiUsageResponse> {
    return this.usage.report(query);
  }
}
