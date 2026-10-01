import { Global, Module } from '@nestjs/common';
import { AuthTransactionRunner } from './auth-transaction-runner.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner } from './tenant-transaction-runner.js';

/**
 * `PrismaService` is deliberately not exported: tenant data goes through `TenantTransactionRunner`,
 * and the pre-tenant steps of authentication through `AuthTransactionRunner`. The platform client
 * (BYPASSRLS login) lives in `PlatformDatabaseModule`, which only the API's platform module imports.
 */
@Global()
@Module({
  providers: [PrismaService, TenantContext, TenantTransactionRunner, AuthTransactionRunner, DatabaseHealthService],
  exports: [TenantContext, TenantTransactionRunner, AuthTransactionRunner, DatabaseHealthService],
})
export class DatabaseModule {}
