import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { ExportCutoffJob } from './export-cutoff.job.js';

/** Every five minutes: a cutoff runs at most that late, and a missed one (a restart) runs once when the worker is back. */
export const EXPORT_CHECK_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class ExportCutoffScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(ExportCutoffJob) private readonly job: ExportCutoffJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, EXPORT_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const { cutoffs, failed } = await this.job.runOnce();
      if (cutoffs > 0 || failed > 0) this.logger.log(`Export cutoffs: ${String(cutoffs)} files, ${String(failed)} failed definitions`, 'ExportCutoffScheduler');
    } catch (error) {
      this.logger.error(error, 'ExportCutoffScheduler');
    }
  }
}
