import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { ExportStoppedError } from '../domain/export-errors.js';
import { DataExportJob } from './data-export.job.js';

export const DATA_EXPORT_CHECK_INTERVAL_MS = 60_000;

/**
 * Looks for due exports every minute, one run at a time in this process. On shutdown the export in progress stops
 * between two writes (WORKER_STOPPED: its upload is aborted and it is tried again soon by any worker).
 */
@Injectable()
export class DataExportScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private readonly stop = new AbortController();

  constructor(
    @Inject(DataExportJob) private readonly job: DataExportJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.running = this.tick();
    }, DATA_EXPORT_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stop.abort(new ExportStoppedError());
    await this.running;
  }

  async tick(): Promise<void> {
    this.busy = true;
    try {
      const { claimed, ready, failed } = await this.job.runOnce(this.stop.signal);
      if (claimed > 0) this.logger.info('data_export.run_done', { event: 'data_export.run_done', claimed, ready, failed });
    } catch (error) {
      this.logger.warn('data_export.run_failed', { event: 'data_export.run_failed', errorName: error instanceof Error ? error.name : typeof error });
    } finally {
      this.busy = false;
    }
  }
}
