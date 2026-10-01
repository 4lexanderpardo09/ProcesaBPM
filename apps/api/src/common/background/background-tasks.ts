import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from '../logging/json-logger.js';

/**
 * Work that must not delay the response, e.g. so that its duration does not reveal anything to
 * the caller. Failures are logged; shutdown waits for what is still running.
 */
@Injectable()
export class BackgroundTasks implements OnApplicationShutdown {
  private readonly pending = new Set<Promise<void>>();

  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  run(name: string, task: () => Promise<void>): void {
    const running: Promise<void> = Promise.resolve()
      .then(task)
      .catch((error: unknown) => this.logger.error(error, name))
      .finally(() => this.pending.delete(running));
    this.pending.add(running);
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }
}
