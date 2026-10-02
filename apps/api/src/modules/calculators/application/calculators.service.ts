import { Inject, Injectable } from '@nestjs/common';
import { type CalculatorDefinition, type CalculatorResponse, findCalculator, listCalculators, NotFoundError, ValidationFailedError } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { CalculatorConfigRepository } from '../data/calculator-config.repository.js';

const describe = (calculator: CalculatorDefinition, config: Record<string, unknown> | undefined): CalculatorResponse => ({
  code: calculator.code,
  parameters: calculator.parameters,
  output: calculator.output,
  configured: config !== undefined,
  config: config ?? null,
});

/** The built-in calculators a tenant can switch on with its own parameters. */
@Injectable()
export class CalculatorsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(CalculatorConfigRepository) private readonly configs: CalculatorConfigRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(): Promise<CalculatorResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const configs = await this.configs.all(tx, this.context.require().tenantId);
      return listCalculators().map((calculator) => describe(calculator, configs.get(calculator.code)));
    });
  }

  configure(code: string, config: unknown): Promise<CalculatorResponse> {
    const calculator = this.require(code);
    const parsed = calculator.configSchema.safeParse(config);
    if (!parsed.success) throw new ValidationFailedError(parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const before = (await this.configs.all(tx, tenantId)).get(code);
      await this.configs.save(tx, tenantId, code, parsed.data);
      await this.audit.record(tx, { action: 'calculator.config_updated', subjectType: 'Setting', subjectId: null, before: { calculator: code, config: before ?? null }, after: { calculator: code, config: parsed.data } });
      return describe(calculator, parsed.data);
    });
  }

  disable(code: string): Promise<CalculatorResponse> {
    const calculator = this.require(code);
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const before = (await this.configs.all(tx, tenantId)).get(code);
      await this.configs.remove(tx, tenantId, code);
      await this.audit.record(tx, { action: 'calculator.config_removed', subjectType: 'Setting', subjectId: null, before: { calculator: code, config: before ?? null } });
      return describe(calculator, undefined);
    });
  }

  private require(code: string): CalculatorDefinition {
    const calculator = findCalculator(code);
    if (calculator === undefined) throw new NotFoundError();
    return calculator;
  }
}
