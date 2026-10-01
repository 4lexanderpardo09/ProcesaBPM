import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BackgroundModule } from './common/background/background.module.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { HealthModule } from './common/health/health.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { ClockModule } from './infrastructure/clock.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';

@Module({
  imports: [ConfigModule.forEntry('api'), ClockModule, LoggingModule, BackgroundModule, DatabaseModule, HealthModule, AuthModule, AuthorizationModule, PlatformModule, OrganizationModule, CatalogModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
