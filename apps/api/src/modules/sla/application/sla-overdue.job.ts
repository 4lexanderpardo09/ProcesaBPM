import { Inject, Injectable } from '@nestjs/common';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';

export const OVERDUE_BATCH_SIZE = 500;

/**
 * Alerts the SLA clocks that went past their due date, across every tenant. The database does it in one
 * atomic statement (`claim_overdue_sla_clocks`): it marks each clock as alerted and queues an `sla.overdue`
 * event in the outbox of the clock's own tenant, so a clock is alerted once even with several workers.
 * This job runs as the worker role and needs no tenant context.
 */
@Injectable()
export class SlaOverdueJob {
  constructor(@Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner) {}

  /** Alerts every overdue clock, a batch at a time; returns how many there were. */
  async runOnce(batchSize: number = OVERDUE_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (;;) {
      const [row] = await this.runner.withoutTenant((tx) => tx.$queryRaw<Array<{ claimed: number }>>`SELECT claim_overdue_sla_clocks(${batchSize}::int) AS claimed`);
      const claimed = row?.claimed ?? 0;
      total += claimed;
      if (claimed < batchSize) return total;
    }
  }
}
