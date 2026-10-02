import { Inject, Injectable, type OnApplicationBootstrap, type BeforeApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { SlaOverdueJob } from './sla-overdue.job.js';

export const OVERDUE_CHECK_INTERVAL_MS = 60_000;

/** Runs the overdue job every minute; a failing run is logged and the next one tries again. */
@Injectable()
export class SlaOverdueScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(SlaOverdueJob) private readonly job: SlaOverdueJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, OVERDUE_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const alerted = await this.job.runOnce();
      if (alerted > 0) this.logger.log(`Alerted ${alerted} overdue SLA clocks`, 'SlaOverdueScheduler');
    } catch (error) {
      this.logger.error(error, 'SlaOverdueScheduler');
    }
  }
}
