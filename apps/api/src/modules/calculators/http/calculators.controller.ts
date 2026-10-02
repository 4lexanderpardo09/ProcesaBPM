import { Body, Controller, Delete, Get, Inject, Param, Put } from '@nestjs/common';
import type { CalculatorResponse } from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { CalculatorsService } from '../application/calculators.service.js';

@Controller('calculators')
export class CalculatorsController {
  constructor(@Inject(CalculatorsService) private readonly calculators: CalculatorsService) {}

  @RequirePermission('update', 'Setting')
  @Get()
  list(): Promise<CalculatorResponse[]> {
    return this.calculators.list();
  }

  @RequirePermission('update', 'Setting')
  @Audited('calculator.config_updated')
  @Put(':code/config')
  configure(@Param('code') code: string, @Body() body: unknown): Promise<CalculatorResponse> {
    return this.calculators.configure(code, body);
  }

  @RequirePermission('update', 'Setting')
  @Audited('calculator.config_removed')
  @Delete(':code/config')
  disable(@Param('code') code: string): Promise<CalculatorResponse> {
    return this.calculators.disable(code);
  }
}
