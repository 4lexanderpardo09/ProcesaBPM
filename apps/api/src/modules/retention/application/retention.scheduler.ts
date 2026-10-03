import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { Clock } from '../../../infrastructure/clock.js';
import { RetentionJob } from './retention.job.js';

export const RETENTION_CHECK_INTERVAL_MS = 60 * 60_000;
/** The first check waits a little after start-up, so a deploy does not add the run to its own load. */
export const RETENTION_FIRST_CHECK_DELAY_MS = 10 * 60_000;
/** Runs start between 06:00 and 10:59 UTC (01:00–05:59 in Colombia). The database allows one run per 20 hours. */
export const RETENTION_WINDOW_START_HOUR_UTC = 6;
export const RETENTION_WINDOW_END_HOUR_UTC = 11;

export function isWithinRetentionWindow(instant: Date): boolean {
  const hour = instant.getUTCHours();
  return hour >= RETENTION_WINDOW_START_HOUR_UTC && hour < RETENTION_WINDOW_END_HOUR_UTC;
}

/**
 * Checks every hour whether tonight's retention run is due; a failing run is logged and the next check tries again.
 * At shutdown the run in progress is told to stop after its current batch, so the worker leaves well within its grace period.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private firstCheck: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private busy = false;
  private readonly stopping = new AbortController();

  constructor(
    @Inject(RetentionJob) private readonly job: RetentionJob,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.firstCheck = setTimeout(() => this.schedule(), RETENTION_FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => this.schedule(), RETENTION_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping.abort();
    clearTimeout(this.firstCheck);
    clearInterval(this.timer);
    this.firstCheck = undefined;
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    if (this.stopping.signal.aborted || !isWithinRetentionWindow(this.clock.now())) return;
    this.busy = true;
    try {
      await this.job.runOnce(this.stopping.signal);
    } catch (error) {
      this.logger.error(error, 'RetentionScheduler');
    } finally {
      this.busy = false;
    }
  }

  private schedule(): void {
    // A run can outlast the interval: never two at once in this process.
    if (this.busy) return;
    this.running = this.tick();
  }
}
