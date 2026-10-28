import { Inject, Injectable } from '@nestjs/common';
import type { PlatformAiUsageQuery, PlatformAiUsageResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { PlatformTransactionRunner } from '../../../infrastructure/database/platform-transaction-runner.js';
import { AiUsageRepository } from '../data/ai-usage.repository.js';
import { aiUsageBounds, aiUsagePeriodOf, sumAiUsage } from '../domain/ai-usage-report.js';

/** The AI assistant's consumption per organization and in total, so the platform can watch its cost. Tokens only, no prices. */
@Injectable()
export class AiUsageService {
  constructor(
    @Inject(PlatformTransactionRunner) private readonly runner: PlatformTransactionRunner,
    @Inject(AiUsageRepository) private readonly usage: AiUsageRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async report(query: PlatformAiUsageQuery): Promise<PlatformAiUsageResponse> {
    const period = aiUsagePeriodOf(query, this.clock.now());
    const { since, until } = aiUsageBounds(period);
    const tenants = await this.runner.run((tx) => this.usage.perTenant(tx, since, until));
    return { ...period, tenants, totals: sumAiUsage(tenants) };
  }
}
