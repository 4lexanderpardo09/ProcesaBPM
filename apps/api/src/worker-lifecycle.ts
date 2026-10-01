import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { JsonLogger } from './common/logging/json-logger.js';

const KEEP_ALIVE_INTERVAL_MS = 60_000;

/** Keeps the worker process alive until a shutdown signal; queue consumers will attach here later. */
@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private keepAlive: NodeJS.Timeout | undefined;

  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  onApplicationBootstrap(): void {
    this.keepAlive = setInterval(() => undefined, KEEP_ALIVE_INTERVAL_MS);
    this.logger.log('Worker started', 'WorkerLifecycle');
  }

  onApplicationShutdown(signal?: string): void {
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.logger.log(`Worker stopped${signal ? ` (${signal})` : ''}`, 'WorkerLifecycle');
  }
}
