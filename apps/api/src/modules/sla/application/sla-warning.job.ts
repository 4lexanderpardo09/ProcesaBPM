import { Inject, Injectable } from '@nestjs/common';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';

export const WARNING_BATCH_SIZE = 500;

/**
 * Warns about the SLA clocks that used 80 % of their time, across every tenant, the same way overdue clocks are alerted:
 * `claim_sla_warnings` marks each clock as warned and queues an `sla.warning` event in its tenant's outbox in one
 * statement, so a clock warns once even with several workers.
 */
@Injectable()
export class SlaWarningJob {
  constructor(@Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner) {}

  /** Warns every due clock, a batch at a time; returns how many there were. */
  async runOnce(batchSize: number = WARNING_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (;;) {
      const [row] = await this.runner.withoutTenant((tx) => tx.$queryRaw<Array<{ claimed: number }>>`SELECT claim_sla_warnings(${batchSize}::int) AS claimed`);
      const claimed = row?.claimed ?? 0;
      total += claimed;
      if (claimed < batchSize) return total;
    }
  }
}
