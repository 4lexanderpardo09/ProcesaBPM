import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { OutboxDispatcher } from './outbox-dispatcher.js';

/**
 * Keeps the dispatcher running: another round right away while batches come back full, otherwise a short sleep.
 * It stays silent when idle. On shutdown it stops claiming, wakes up from its sleep and waits for the round in
 * flight, before the database connections are closed.
 */
@Injectable()
export class OutboxPoller implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private stopping = false;
  private wake: (() => void) | undefined;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
  ) {}

  onApplicationBootstrap(): void {
    if (this.settings.OUTBOX_POLLING_ENABLED) this.loop = this.run();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let again = false;
      try {
        again = (await this.dispatcher.runOnce()).full;
      } catch (error) {
        this.logger.error(error, 'OutboxPoller');
      }
      if (!again && !this.stopping) await this.sleep(this.settings.OUTBOX_POLL_INTERVAL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }
}
