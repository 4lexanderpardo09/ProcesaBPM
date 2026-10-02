import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BackgroundModule } from './common/background/background.module.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { HealthModule } from './common/health/health.module.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { ConfigModule } from './config/config.module.js';
import { ClockModule } from './infrastructure/clock.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CalculatorsModule } from './modules/calculators/calculators.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';
import { TicketsModule } from './modules/tickets/tickets.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';

@Module({
  imports: [ConfigModule.forEntry('api'), ClockModule, LoggingModule, BackgroundModule, DatabaseModule.forEntry('api'), StorageModule, HealthModule, AuthModule, AuthorizationModule, PlatformModule, OrganizationModule, CatalogModule, IdentityModule, ApprovalsModule, WorkflowsModule, CalculatorsModule, FilesModule, DocumentsModule, NotificationsModule, TicketsModule, ReportsModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
