import { Inject, Injectable } from '@nestjs/common';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { DispatchRepository } from '../data/dispatch.repository.js';
import { DispatchStepService } from './dispatch-step.service.js';

export const DISPATCH_BATCH_SIZE = 200;

/**
 * Hands out the waiting tickets of every RANDOM_DISPATCH step whose interval elapsed. The database picks the
 * steps (`claim_random_dispatch_steps`, stamping their dispatch time atomically); each one is then served inside
 * its own tenant. One step failing does not stop the others.
 */
@Injectable()
export class RandomDispatchJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(DispatchRepository) private readonly dispatches: DispatchRepository,
    @Inject(DispatchStepService) private readonly dispatch: DispatchStepService,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  async runOnce(): Promise<{ steps: number; tickets: number; failed: number }> {
    const due = await this.runner.withoutTenant((tx) => this.dispatches.claimDueSteps(tx, DISPATCH_BATCH_SIZE));
    let tickets = 0;
    let failed = 0;
    for (const { tenantId, stepId } of due) {
      try {
        tickets += await this.dispatch.dispatchStep(tenantId, stepId);
      } catch (error) {
        failed += 1;
        this.logger.error(error, 'RandomDispatchJob');
      }
    }
    return { steps: due.length, tickets, failed };
  }
}
