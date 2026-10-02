import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { CalculatorsPublicationCheck } from './application/calculators.publication-check.js';
import { CalculatorsService } from './application/calculators.service.js';
import { CalculatorConfigRepository } from './data/calculator-config.repository.js';
import { CalculatorsController } from './http/calculators.controller.js';

/** The built-in calculators (meal allowance…) a tenant switches on and parameterizes. */
@Module({
  imports: [WorkflowsModule],
  controllers: [CalculatorsController],
  providers: [CalculatorConfigRepository, CalculatorsService, CalculatorsPublicationCheck],
  exports: [CalculatorConfigRepository],
})
export class CalculatorsModule {}
