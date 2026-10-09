import { Inject, Injectable, type OnApplicationBootstrap, type BeforeApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { SlaOverdueJob } from './sla-overdue.job.js';
import { SlaWarningJob } from './sla-warning.job.js';

export const OVERDUE_CHECK_INTERVAL_MS = 60_000;

/** Every minute: alerts the overdue clocks, then warns those at 80 % of their time; a failing run is logged and the next one tries again. */
@Injectable()
export class SlaOverdueScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(SlaOverdueJob) private readonly job: SlaOverdueJob,
    @Inject(SlaWarningJob) private readonly warnings: SlaWarningJob,
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
    // Separately: a failing overdue run must not hold the warnings back, nor the other way round.
    try {
      const warned = await this.warnings.runOnce();
      if (warned > 0) this.logger.log(`Warned ${warned} SLA clocks at 80 % of their time`, 'SlaOverdueScheduler');
    } catch (error) {
      this.logger.error(error, 'SlaOverdueScheduler');
    }
  }
}
