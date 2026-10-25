import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { findCalculator, type WorkflowProblem, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type PublicationCheck, PublicationCheckRegistry } from '../../workflows/application/publication-check.registry.js';
import { CalculatorConfigRepository } from '../data/calculator-config.repository.js';

/**
 * A version cannot be published using a calculator the tenant has not switched on (configured), nor naming one of its
 * tables the tenant does not have: either would produce blanks. Old codes resolve to the calculator they meant.
 */
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
      ...document.fields.filter((field) => field.type === 'CALCULATOR').map((field) => ({ code: String(field.config.calculatorCode ?? ''), table: field.config.table, location: { fieldId: field.id } })),
      ...document.steps.filter((step) => step.type === 'CALCULATOR').map((step) => ({ code: String(step.config.calculatorCode ?? ''), table: step.config.table, location: { stepId: step.id } })),
    ].flatMap((use) => {
      const calculator = findCalculator(use.code);
      return calculator === undefined ? [] : [{ ...use, calculator }];
    });
    if (uses.length === 0) return [];
    const configured = await this.configs.all(tx, tenantId);
    return uses.flatMap((use): WorkflowProblem[] => {
      const config = configured.get(use.calculator.code);
      if (config === undefined) return [{ code: 'CALCULATOR_NOT_CONFIGURED', severity: 'error', ...use.location, params: { code: use.calculator.code } }];
      if (!use.calculator.usesTable || typeof use.table !== 'string') return [];
      const tables = Array.isArray(config.tables) ? (config.tables as Array<{ code?: unknown }>).map((entry) => entry.code) : [];
      return tables.includes(use.table) ? [] : [{ code: 'CALCULATOR_TABLE_UNKNOWN', severity: 'error', ...use.location, params: { code: use.calculator.code, table: use.table } }];
    });
  }
}
