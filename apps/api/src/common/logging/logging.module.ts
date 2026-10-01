import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { JsonLogger, LOG_WRITER } from './json-logger.js';
import { RequestContext } from './request-context.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

@Global()
@Module({
  providers: [
    RequestContext,
    JsonLogger,
    { provide: LOG_WRITER, useValue: (line: string) => process.stdout.write(`${line}\n`) },
  ],
  exports: [RequestContext, JsonLogger],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
