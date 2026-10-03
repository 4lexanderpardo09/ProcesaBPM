import { Inject, Injectable } from '@nestjs/common';
import { InvalidTenantContextError, isUuid } from '@procesabpm/shared';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { applyDatabaseScope, databaseTimeouts } from './database-scope.js';
import { PrismaService } from './prisma.service.js';
import { asScoped, type CrossTenantTransaction, type TenantTransaction } from './transaction-scope.js';

export type { CrossTenantTransaction } from './transaction-scope.js';

export interface TransactionOptions {
  /** For work that is slower than the default (e.g. fan-out to many recipients). */
  readonly timeoutMs?: number;
}

/**
 * Transactions for the worker's jobs that look across tenants (claiming outbox events, alerting overdue SLA
 * clocks). The tenant setting is explicitly empty: tenant tables answer nothing, and only the `SECURITY DEFINER`
 * functions granted to the worker role reach other tenants' rows. Work on one tenant's data then goes through
 * `TenantTransactionRunner` with that tenant's context.
 */
@Injectable()
export class WorkerTransactionRunner {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * One tenant's data from a job that has no user: `app.tenant_id` is that tenant (RLS applies as for any request) and
   * `app.user_id` is explicitly empty. The tenant comes from a worker function that read it from the tenant's own rows.
   */
  withTenant<T>(tenantId: string, work: (tx: TenantTransaction) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    if (!isUuid(tenantId)) return Promise.reject(new InvalidTenantContextError());
    return this.prisma.$transaction(
      async (tx) => {
        await applyDatabaseScope(tx, { tenantId, userId: '', ...databaseTimeouts(this.config, options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS, options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS) });
        return work(asScoped<TenantTransaction>(tx));
      },
      { timeout: options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS, maxWait: this.config.DB_TX_MAX_WAIT_MS },
    );
  }

  withoutTenant<T>(work: (tx: CrossTenantTransaction) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await applyDatabaseScope(tx, { tenantId: '', userId: '', ...databaseTimeouts(this.config, options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS, options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS) });
        return work(asScoped<CrossTenantTransaction>(tx));
      },
      { timeout: options.timeoutMs ?? this.config.DB_TX_TIMEOUT_MS, maxWait: this.config.DB_TX_MAX_WAIT_MS },
    );
  }
}
