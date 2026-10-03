import { type BeforeApplicationShutdown, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { TenantPurgeJob } from './tenant-purge.job.js';

export const TENANT_PURGE_CHECK_INTERVAL_MS = 5 * 60_000;

/** Looks for due purges every 5 minutes; a failing run is logged and the next one tries again. */
@Injectable()
export class TenantPurgeScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(TenantPurgeJob) private readonly job: TenantPurgeJob,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.running = this.tick();
    }, TENANT_PURGE_CHECK_INTERVAL_MS);
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  async tick(): Promise<void> {
    try {
      const { purged, failed } = await this.job.runOnce();
      if (purged > 0 || failed > 0) this.logger.log(`Tenant purge: ${purged} purged, ${failed} failed`, 'TenantPurgeScheduler');
    } catch (error) {
      this.logger.error(error, 'TenantPurgeScheduler');
    }
  }
}
