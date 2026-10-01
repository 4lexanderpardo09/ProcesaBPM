import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import type { EntryPoint } from '../../config/app-config.js';
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
const COMMON_PROVIDERS: Provider[] = [PrismaService, TenantContext, TenantTransactionRunner, AuthTransactionRunner, DatabaseHealthService];
const COMMON_EXPORTS = [TenantContext, TenantTransactionRunner, AuthTransactionRunner, DatabaseHealthService];

/**
 * `PrismaService` is deliberately not exported: tenant data goes through `TenantTransactionRunner`,
 * and the pre-tenant steps of authentication through `AuthTransactionRunner`. The platform client
 * (BYPASSRLS login) exists only in the API: the worker has no such login.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forEntry(entry: EntryPoint): DynamicModule {
    const platform = entry === 'api' ? [PlatformPrismaService] : [];
    return {
      module: DatabaseModule,
      providers: [...COMMON_PROVIDERS, ...platform],
      exports: [...COMMON_EXPORTS, ...platform],
    };
  }
}
