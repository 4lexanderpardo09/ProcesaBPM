import { Global, Module } from '@nestjs/common';
import { AuthTransactionRunner } from './auth-transaction-runner.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PlatformPrismaService } from './platform-prisma.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner } from './tenant-transaction-runner.js';

/**
 * `PrismaService` is deliberately not exported: tenant data goes through `TenantTransactionRunner`,
 * and the pre-tenant steps of authentication through `AuthTransactionRunner`.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    PlatformPrismaService,
    TenantContext,
    TenantTransactionRunner,
    AuthTransactionRunner,
    DatabaseHealthService,
  ],
  exports: [PlatformPrismaService, TenantContext, TenantTransactionRunner, AuthTransactionRunner, DatabaseHealthService],
})
export class DatabaseModule {}
