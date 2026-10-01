import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Put } from '@nestjs/common';
import { type SiteLevelResponse, siteLevelParamSchema, type UpsertSiteLevelRequest, upsertSiteLevelRequestSchema } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { SiteLevelsService } from '../application/site-levels.service.js';

@Controller('site-levels')
export class SiteLevelsController {
  constructor(@Inject(SiteLevelsService) private readonly levels: SiteLevelsService) {}

  @RequirePermission('read', 'Site')
  @Get()
  list(): Promise<SiteLevelResponse[]> {
    return this.levels.list();
  }

  @RequirePermission('update', 'Site')
  @Put(':level')
  name(@Param('level', new ZodValidationPipe(siteLevelParamSchema)) level: number, @Body(new ZodValidationPipe(upsertSiteLevelRequestSchema)) body: UpsertSiteLevelRequest): Promise<SiteLevelResponse> {
    return this.levels.name(level, body.name);
  }

  @RequirePermission('delete', 'Site')
  @Delete(':level')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('level', new ZodValidationPipe(siteLevelParamSchema)) level: number): Promise<void> {
    return this.levels.remove(level);
  }
}
