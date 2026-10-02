import { Inject, Injectable } from '@nestjs/common';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';

export const WAIT_BATCH_SIZE = 500;

/**
 * Wakes the tickets parked on WAIT blocks whose time has come, across every tenant. The database does it in one
 * atomic statement (`claim_due_waits`): it stamps each visit and queues a `ticket.wait_elapsed` event in the outbox of
 * the ticket's own tenant, so a visit is woken once even with several workers; the outbox handler moves the ticket.
 */
@Injectable()
export class WaitResumeJob {
  constructor(@Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner) {}

  /** Queues the wake-up of every due visit, a batch at a time; returns how many there were. */
  async runOnce(batchSize: number = WAIT_BATCH_SIZE): Promise<number> {
    let total = 0;
    for (;;) {
      const [row] = await this.runner.withoutTenant((tx) => tx.$queryRaw<Array<{ claimed: number }>>`SELECT claim_due_waits(${batchSize}::int) AS claimed`);
      const claimed = row?.claimed ?? 0;
      total += claimed;
      if (claimed < batchSize) return total;
    }
  }
}
