import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import { InvalidTenantContextError, isUuid } from '@procesabpm/shared';
import type { AppConfig } from '../../config/app-config.js';
import { APP_CONFIG } from '../../config/tokens.js';
import { applyDatabaseScope, type DatabaseScope } from './database-scope.js';
import { PrismaService } from './prisma.service.js';

export type AuthTransaction = Prisma.TransactionClient;

const NOT_SET = '';

/**
 * Transactions for the steps that happen before a tenant is chosen (login, refresh, password reset).
 * The tenant setting is explicitly empty, so tenant tables answer nothing; only the `auth_*`
 * functions and the user's own rows (`refresh_sessions`) are reachable. Only the auth module uses it.
 */
@Injectable()
export class AuthTransactionRunner {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** No user yet: only the `SECURITY DEFINER` lookups by e-mail or token hash. */
  withAnonymousTransaction<T>(work: (tx: AuthTransaction) => Promise<T>): Promise<T> {
    return this.run({ tenantId: NOT_SET, userId: NOT_SET }, work);
  }

  /** Acts as `userId` (`app.user_id`), still without a tenant. */
  withUserTransaction<T>(userId: string, work: (tx: AuthTransaction) => Promise<T>): Promise<T> {
    if (!isUuid(userId)) return Promise.reject(new InvalidTenantContextError());
    return this.run({ tenantId: NOT_SET, userId }, work);
  }

  private run<T>(scope: DatabaseScope, work: (tx: AuthTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await applyDatabaseScope(tx, scope);
        return work(tx);
      },
      { timeout: this.config.DB_TX_TIMEOUT_MS, maxWait: this.config.DB_TX_MAX_WAIT_MS },
    );
  }
}
