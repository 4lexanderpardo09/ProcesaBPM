import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { RATE_LIMITER, type RateLimiter } from '../../src/infrastructure/security/rate-limiter.js';

export interface TestApp {
  readonly app: INestApplication;
  readonly moduleRef: TestingModule;
  /** JSON log lines the application wrote, instead of printing them. */
  readonly logLines: string[];
}

export interface TestAppOptions {
  readonly controllers?: Type[];
  /** Rate limiting is off by default so that tests can log in many times from 127.0.0.1. */
  readonly rateLimiting?: boolean;
}

const unlimited: RateLimiter = { hit: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) };

export async function createTestApp({ controllers = [], rateLimiting = false }: TestAppOptions = {}): Promise<TestApp> {
  const logLines: string[] = [];
  let builder = Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(LOG_WRITER)
    .useValue((line: string) => logLines.push(line));
  if (!rateLimiting) builder = builder.overrideProvider(RATE_LIMITER).useValue(unlimited);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, moduleRef, logLines };
}
