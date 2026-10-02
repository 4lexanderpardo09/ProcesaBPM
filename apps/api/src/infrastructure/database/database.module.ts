import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { AuthTransactionRunner } from './auth-transaction-runner.js';
import { DatabaseHealthService } from './database-health.service.js';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';
import { TenantTransactionRunner } from './tenant-transaction-runner.js';
import { WorkerTransactionRunner } from './worker-transaction-runner.js';

export type DatabaseEntry = 'api' | 'worker';

/** What each process may open: the API never runs cross-tenant jobs, the worker never authenticates anybody. */
const RUNNERS: Record<DatabaseEntry, Provider[]> = {
  api: [AuthTransactionRunner],
  worker: [WorkerTransactionRunner],
};

/**
 * `PrismaService` is deliberately not exported: tenant data goes through `TenantTransactionRunner`,
 * and the pre-tenant steps of authentication through `AuthTransactionRunner`. The platform client
 * (BYPASSRLS login) lives in `PlatformDatabaseModule`, which only the API's platform module imports.
 */
@Global()
@Module({})
export class DatabaseModule {
  static forEntry(entry: DatabaseEntry): DynamicModule {
    const providers = [TenantContext, TenantTransactionRunner, DatabaseHealthService, ...RUNNERS[entry]];
    return { module: DatabaseModule, providers: [PrismaService, ...providers], exports: providers };
  }
}
