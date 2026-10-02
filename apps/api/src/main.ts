import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json-logger.js';
import { API_CONFIG } from './config/tokens.js';
import { configureHttpApp } from './http-app.js';
import type { ApiConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(JsonLogger));
  app.enableShutdownHooks();
  const config = app.get<ApiConfig>(API_CONFIG);
  configureHttpApp(app, config);
  await app.listen(config.PORT);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
