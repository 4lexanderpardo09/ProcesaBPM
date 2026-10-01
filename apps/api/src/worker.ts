import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { JsonLogger } from './common/logging/json-logger.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(JsonLogger));
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
