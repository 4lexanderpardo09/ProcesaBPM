import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { WorkerModule } from '../../src/worker.module.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ LOG_LEVEL: 'info' });

describe('worker', () => {
  it('starts and shuts down gracefully, releasing the database connections', async () => {
    const lines: string[] = [];
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue((line: string) => lines.push(line))
      .compile();

    await moduleRef.init();
    await moduleRef.close();

    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      'Worker started',
      'Worker stopped',
    ]);
  });
});
