import { Global, Module } from '@nestjs/common';
import { DatabaseHealthService } from './database-health.service.js';
import { PlatformPrismaService } from './platform-prisma.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner } from './tenant-transaction-runner.js';

/** `PrismaService` is deliberately not exported: tenant data goes through `TenantTransactionRunner`. */
@Global()
@Module({
  providers: [PrismaService, PlatformPrismaService, TenantContext, TenantTransactionRunner, DatabaseHealthService],
  exports: [PlatformPrismaService, TenantContext, TenantTransactionRunner, DatabaseHealthService],
})
export class DatabaseModule {}
