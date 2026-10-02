import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { TenantContext } from '../../infrastructure/database/tenant-context.js';
import { JsonLogger } from '../logging/json-logger.js';
import { RequestContext } from '../logging/request-context.js';
import { BackgroundTasks } from './background-tasks.js';

function setup() {
  const lines: string[] = [];
  const logger = new JsonLogger({ LOG_LEVEL: 'debug' } as AppConfig, new TenantContext(), new RequestContext(), (line) => lines.push(line));
  return { tasks: new BackgroundTasks(logger), lines };
}

describe('BackgroundTasks', () => {
  it('returns before the task runs and lets callers wait for it', async () => {
    const { tasks } = setup();
    const done: string[] = [];
    tasks.run('job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push('job');
    });
    expect(done).toEqual([]);
    await tasks.whenIdle();
    expect(done).toEqual(['job']);
  });

  it('logs failures instead of throwing them', async () => {
    const { tasks, lines } = setup();
    tasks.run('failing-job', () => Promise.reject(new Error('boom')));
    await tasks.whenIdle();
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'error', message: 'boom', context: 'failing-job' });
  });

  it('waits for pending tasks on shutdown', async () => {
    const { tasks } = setup();
    let finished = false;
    tasks.run('job', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await tasks.beforeApplicationShutdown();
    expect(finished).toBe(true);
  });
});
