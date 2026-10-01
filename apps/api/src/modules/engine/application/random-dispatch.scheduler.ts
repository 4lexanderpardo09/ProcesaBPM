import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { RandomDispatchJob } from './random-dispatch.job.js';

export const DISPATCH_CHECK_INTERVAL_MS = 60_000;

/** Runs the dispatch job every minute (each step has its own interval, enforced by the database); a failing run is logged. */
@Injectable()
export class RandomDispatchScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(RandomDispatchJob) private readonly job: RandomDispatchJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, DISPATCH_CHECK_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const { tickets } = await this.job.runOnce();
      if (tickets > 0) this.logger.log(`Dispatched ${tickets} waiting tickets`, 'RandomDispatchScheduler');
    } catch (error) {
      this.logger.error(error, 'RandomDispatchScheduler');
    }
  }
}
