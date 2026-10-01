import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { JsonLogger } from './common/logging/json-logger.js';
import { APP_CONFIG } from './config/tokens.js';
import type { AppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(JsonLogger));
  app.enableShutdownHooks();
  const { PORT } = app.get<AppConfig>(APP_CONFIG);
  await app.listen(PORT);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
