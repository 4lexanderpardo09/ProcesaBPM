import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { findCalculator, type WorkflowProblem, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type PublicationCheck, PublicationCheckRegistry } from '../../workflows/application/publication-check.registry.js';
import { CalculatorConfigRepository } from '../data/calculator-config.repository.js';

/** A version cannot be published using a calculator the tenant has not switched on (configured): it would produce blanks. */
@Injectable()
export class CalculatorsPublicationCheck implements PublicationCheck, OnModuleInit {
  constructor(
    @Inject(PublicationCheckRegistry) private readonly registry: PublicationCheckRegistry,
    @Inject(CalculatorConfigRepository) private readonly configs: CalculatorConfigRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(tx: TenantTransaction, tenantId: string, _workflowId: string, document: WorkflowVersionDocument): Promise<WorkflowProblem[]> {
    const uses = [
      ...document.fields.filter((field) => field.type === 'CALCULATOR').map((field) => ({ code: String(field.config.calculatorCode ?? ''), location: { fieldId: field.id } })),
      ...document.steps.filter((step) => step.type === 'CALCULATOR').map((step) => ({ code: String(step.config.calculatorCode ?? ''), location: { stepId: step.id } })),
    ].filter((use) => findCalculator(use.code) !== undefined);
    if (uses.length === 0) return [];
    const configured = await this.configs.all(tx, tenantId);
    return uses.filter((use) => !configured.has(use.code)).map((use): WorkflowProblem => ({ code: 'CALCULATOR_NOT_CONFIGURED', severity: 'error', ...use.location, params: { code: use.code } }));
  }
}
