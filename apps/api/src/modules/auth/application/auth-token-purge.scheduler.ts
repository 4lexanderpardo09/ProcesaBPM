import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { AuthTokenPurgeJob } from './auth-token-purge.job.js';

export const AUTH_TOKEN_PURGE_INTERVAL_MS = 60 * 60_000;

/** Runs the purge of used login token ids every hour; a failing run is logged and the next one tries again. */
@Injectable()
export class AuthTokenPurgeScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(AuthTokenPurgeJob) private readonly job: AuthTokenPurgeJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, AUTH_TOKEN_PURGE_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      await this.job.runOnce();
    } catch (error) {
      this.logger.error(error, 'AuthTokenPurgeScheduler');
    }
  }
}
