import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';

export interface TestApp {
  readonly app: INestApplication;
  /** JSON log lines the application wrote, instead of printing them. */
  readonly logLines: string[];
}

export async function createTestApp(controllers: Type[] = []): Promise<TestApp> {
  const logLines: string[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(LOG_WRITER)
    .useValue((line: string) => logLines.push(line))
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, logLines };
}
