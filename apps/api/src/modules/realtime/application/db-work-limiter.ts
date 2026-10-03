import { Inject, Injectable } from '@nestjs/common';
import { TemporarilyUnavailableError } from '@procesabpm/shared';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';

const RETRY_AFTER_SECONDS = 1;

interface Waiter {
  readonly start: () => void;
  readonly abandon: () => void;
}

/**
 * Bounds the database work of real time (handshakes, re-verifications, per-recipient reads) to
 * `REALTIME_DB_CONCURRENCY` transactions at a time, so a reconnection storm leaves the HTTP requests their connections.
 * Work waits in line; with a timeout, a caller that waited (or ran) too long gets `TemporarilyUnavailableError`. A
 * slot is only released when the work really finishes, so the bound holds even for abandoned work.
 */
@Injectable()
export class DbWorkLimiter {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(@Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'REALTIME_DB_CONCURRENCY'>) {}

  get inFlight(): number {
    return this.running;
  }

  get waiting(): number {
    return this.queue.length;
  }

  run<T>(work: () => Promise<T>, timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
        settled = true;
        waiter.abandon();
        reject(new TemporarilyUnavailableError(RETRY_AFTER_SECONDS));
      }, timeoutMs);
      const waiter: Waiter = {
        start: () => {
          this.running += 1;
          work()
            .then(
              (value) => !settled && resolve(value),
              (error: unknown) => !settled && reject(error),
            )
            .finally(() => {
              settled = true;
              clearTimeout(timer);
              this.release();
            });
        },
        abandon: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
        },
      };
      if (this.running < this.config.REALTIME_DB_CONCURRENCY) waiter.start();
      else this.queue.push(waiter);
    });
  }

  private release(): void {
    this.running -= 1;
    this.queue.shift()?.start();
  }
}
