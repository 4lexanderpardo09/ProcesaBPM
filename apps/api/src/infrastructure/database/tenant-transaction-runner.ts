import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { applyDatabaseScope, databaseTimeouts } from './database-scope.js';
import { PrismaService } from './prisma.service.js';
import { TenantContext } from './tenant-context.js';

export type TenantTransaction = Prisma.TransactionClient;

/**
 * Runs database work for the current tenant (docs/base-de-datos.md §6.2): one interactive
 * transaction whose first statement fixes `app.tenant_id` and `app.user_id` as transaction-local
 * settings, so a pooled connection never carries them to the next request.
 */
@Injectable()
export class TenantTransactionRunner {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContext) private readonly tenantContext: TenantContext,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Throws `MissingTenantContextError` when there is no tenant context: it never queries without one. */
  async withTenantTransaction<T>(work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const scope = this.tenantContext.require();
    return this.prisma.$transaction(
      async (tx) => {
        await applyDatabaseScope(tx, { ...scope, ...databaseTimeouts(this.config, this.config.DB_TX_TIMEOUT_MS) });
        return work(tx);
      },
      { timeout: this.config.DB_TX_TIMEOUT_MS, maxWait: this.config.DB_TX_MAX_WAIT_MS },
    );
  }
}
