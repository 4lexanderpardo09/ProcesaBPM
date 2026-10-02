import { Inject, Injectable, type OnApplicationBootstrap, type BeforeApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WaitResumeJob } from './wait-resume.job.js';

export const WAIT_CHECK_INTERVAL_MS = 60_000;

/** Wakes the due WAIT blocks every minute (the database guarantees each is woken once); a failing run is logged. */
@Injectable()
export class WaitResumeScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(WaitResumeJob) private readonly job: WaitResumeJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, WAIT_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const woken = await this.job.runOnce();
      if (woken > 0) this.logger.log(`Woke ${woken} waiting tickets`, 'WaitResumeScheduler');
    } catch (error) {
      this.logger.error(error, 'WaitResumeScheduler');
    }
  }
}
