import { Inject, Injectable } from '@nestjs/common';
import { businessDayChecker, type ComputeContext, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { CalculatorConfigRepository } from '../../calculators/data/calculator-config.repository.js';
import type { ResolvedCalendar } from '../data/ticket-context.repository.js';
import { localDateIn } from '../domain/local-date.js';

export interface EnvironmentSource {
  readonly timeZone: string;
  readonly calendar: ResolvedCalendar | null;
  readonly at: Date;
}

const usesCalculators = (document: WorkflowVersionDocument): boolean => document.fields.some((field) => field.type === 'CALCULATOR') || document.steps.some((step) => step.type === 'CALCULATOR');

/** What computed fields and CALCULATOR blocks need from the outside: today's date, the company's working days and the tenant's calculator settings. */
@Injectable()
export class ComputeEnvironment {
  constructor(@Inject(CalculatorConfigRepository) private readonly configs: CalculatorConfigRepository) {}

  async build(tx: TenantTransaction, tenantId: string, document: WorkflowVersionDocument, source: EnvironmentSource): Promise<ComputeContext> {
    let checker: ((date: string) => boolean) | undefined;
    return {
      today: localDateIn(source.timeZone, source.at),
      timeZone: source.timeZone,
      // Built on first use: a company calendar only has to be valid for the flows that ask about working days.
      ...(source.calendar === null ? {} : { isBusinessDay: (date: string) => (checker ??= businessDayChecker(source.calendar!.calendar))(date) }),
      ...(usesCalculators(document) ? { calculatorConfigs: await this.configs.all(tx, tenantId) } : {}),
    };
  }
}
