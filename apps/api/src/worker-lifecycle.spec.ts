import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './config/app-config.js';
import { JsonLogger } from './common/logging/json-logger.js';
import { RequestContext } from './common/logging/request-context.js';
import { TenantContext } from './infrastructure/database/tenant-context.js';
import { WorkerLifecycle } from './worker-lifecycle.js';

describe('WorkerLifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the process alive until shutdown and logs both events', () => {
    const lines: string[] = [];
    const logger = new JsonLogger({ LOG_LEVEL: 'info' } as AppConfig, new TenantContext(), new RequestContext(), (line) =>
      lines.push(line),
    );
    const lifecycle = new WorkerLifecycle(logger);

    lifecycle.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(1);

    lifecycle.onApplicationShutdown('SIGTERM');
    expect(vi.getTimerCount()).toBe(0);
    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      'Worker started',
      'Worker stopped (SIGTERM)',
    ]);
  });
});
