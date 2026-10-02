import { Inject, Injectable, type OnApplicationBootstrap, type BeforeApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { FilePurgeJob } from './file-purge.job.js';

export const PURGE_CHECK_INTERVAL_MS = 15 * 60_000;

/** Runs the purge of abandoned uploads every 15 minutes; a failing run is logged and the next one tries again. */
@Injectable()
export class FilePurgeScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(FilePurgeJob) private readonly job: FilePurgeJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, PURGE_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const { files } = await this.job.runOnce();
      if (files > 0) this.logger.log(`Purged ${files} abandoned uploads`, 'FilePurgeScheduler');
    } catch (error) {
      this.logger.error(error, 'FilePurgeScheduler');
    }
  }
}
