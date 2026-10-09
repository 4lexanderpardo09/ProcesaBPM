import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { PurgeReminderRepository } from '../data/purge-reminder.repository.js';

export const PURGE_REMINDER_CHECK_INTERVAL_MS = 60 * 60_000;
/** Tenants per call; a run keeps calling while a call fills its batch. */
const REMINDERS_PER_CALL = 100;
const MAX_CALLS_PER_RUN = 10;

/**
 * B17: reminds the owner 7 days and 1 day before the purge. Checks every hour (a reminder may go out up to an hour after
 * its mark); the database function makes each reminder go out once even with several workers.
 */
@Injectable()
export class PurgeReminderScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private busy = false;

  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(PurgeReminderRepository) private readonly reminders: PurgeReminderRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.running = this.tick();
    }, PURGE_REMINDER_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    this.busy = true;
    try {
      const queued = await this.runOnce();
      if (queued > 0) this.logger.log(`Purge reminders: ${queued} queued`, 'PurgeReminderScheduler');
    } catch (error) {
      this.logger.error(error, 'PurgeReminderScheduler');
    } finally {
      this.busy = false;
    }
  }

  /** Queues every due reminder (in batches); returns how many e-mails went to the outbox. */
  async runOnce(): Promise<number> {
    let total = 0;
    for (let call = 0; call < MAX_CALLS_PER_RUN; call += 1) {
      const queued = await this.runner.withoutTenant((tx) => this.reminders.enqueueDue(tx, REMINDERS_PER_CALL));
      total += queued;
      if (queued < REMINDERS_PER_CALL) break;
    }
    return total;
  }
}
