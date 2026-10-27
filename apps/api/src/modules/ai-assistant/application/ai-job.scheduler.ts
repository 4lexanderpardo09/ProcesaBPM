import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import { WorkflowDraftJob } from './workflow-draft.job.js';

/**
 * Looks for due AI requests every few seconds (the person is waiting on screen), one at a time in this process. On
 * shutdown the call in flight is aborted: the request's lease expires and another worker tries it once more.
 */
@Injectable()
export class AiJobScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private readonly stop = new AbortController();

  constructor(
    @Inject(WorkflowDraftJob) private readonly job: WorkflowDraftJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(WORKER_SETTINGS) private readonly settings: Pick<WorkerSettings, 'AI_POLLING_ENABLED' | 'AI_POLL_INTERVAL_MS'>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.settings.AI_POLLING_ENABLED) return;
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.running = this.tick();
    }, this.settings.AI_POLL_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stop.abort();
    await this.running;
  }

  async tick(): Promise<void> {
    this.busy = true;
    try {
      const { claimed, succeeded, failed } = await this.job.runOnce(this.stop.signal);
      if (claimed > 0) this.logger.info('ai_job.run_done', { event: 'ai_job.run_done', claimed, succeeded, failed });
    } catch (error) {
      this.logger.warn('ai_job.run_failed', { event: 'ai_job.run_failed', errorName: error instanceof Error ? error.name : typeof error });
    } finally {
      this.busy = false;
    }
  }
}
