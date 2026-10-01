import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { HealthModule } from './common/health/health.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';

@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
