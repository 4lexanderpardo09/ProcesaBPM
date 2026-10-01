import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import type { AppConfig } from '../../src/config/app-config.js';
import { APP_CONFIG } from '../../src/config/tokens.js';
import { configureHttpApp } from '../../src/http-app.js';
import { RATE_LIMITER, type RateLimiter } from '../../src/infrastructure/security/rate-limiter.js';
import { SUBJECT_REGISTRY } from '../../src/modules/authorization/application/ability.service.js';
import { testRegistry } from '../../src/modules/authorization/domain/test-subjects.js';

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
    .useValue((line: string) => logLines.push(line))
    // The fake subject stands in for the tickets module, which registers its own later.
    .overrideProvider(SUBJECT_REGISTRY)
    .useValue(testRegistry());
  if (!rateLimiting) builder = builder.overrideProvider(RATE_LIMITER).useValue(unlimited);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttpApp(app, moduleRef.get<AppConfig>(APP_CONFIG));
  await app.init();
  return { app, moduleRef, logLines };
}
