import type { Prisma } from '@procesabpm/db';
import { TenantContextMismatchError } from '@procesabpm/shared';

/** Values of `app.tenant_id` / `app.user_id`; an empty string means "not set" for the database. */
export interface DatabaseScope {
  readonly tenantId: string;
  readonly userId: string;
  /**
   * Upper bounds the database itself enforces for this transaction: how long a statement may wait for a lock and how long
   * any one statement may run. Prisma's transaction timeout alone cannot cancel a statement stuck behind a row lock, so
   * without these a stuck lock holds the request (and a pool connection) until it is released.
   */
  readonly lockTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
}

interface AppliedScope {
  tenant_id: string;
  user_id: string;
  lock_timeout: string;
  statement_timeout: string;
}

/**
 * Sets both settings as transaction-local (docs/base-de-datos.md §6.2). The statement echoes the
 * values it set; checking them makes a mixed-up response (the failure mode of prisma/orm#30374)
 * stop the transaction before any data is read or written.
 */
export async function applyDatabaseScope(tx: Prisma.TransactionClient, scope: DatabaseScope): Promise<void> {
  // One round trip: the timeouts (when given) are set by the same statement, before anything else runs.
  const lockTimeout = scope.lockTimeoutMs === undefined ? null : String(scope.lockTimeoutMs);
  const statementTimeout = scope.statementTimeoutMs === undefined ? null : String(scope.statementTimeoutMs);
  const [applied] = await tx.$queryRaw<AppliedScope[]>`
    SELECT set_config('app.tenant_id', ${scope.tenantId}, true) AS tenant_id,
           set_config('app.user_id', ${scope.userId}, true) AS user_id,
           set_config('lock_timeout', COALESCE(${lockTimeout}::text, current_setting('lock_timeout')), true) AS lock_timeout,
           set_config('statement_timeout', COALESCE(${statementTimeout}::text, current_setting('statement_timeout')), true) AS statement_timeout`;
  if (applied?.tenant_id !== scope.tenantId || applied.user_id !== scope.userId) {
    throw new TenantContextMismatchError();
  }
}

/** Only the timeouts, for transactions that have no tenant scope (the platform login). */
export async function applyDatabaseTimeouts(tx: Prisma.TransactionClient, timeouts: Required<Pick<DatabaseScope, 'lockTimeoutMs' | 'statementTimeoutMs'>>): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(timeouts.lockTimeoutMs)}, true), set_config('statement_timeout', ${String(timeouts.statementTimeoutMs)}, true)`;
}

/** The database-side bounds of a transaction that Prisma lets run for `transactionTimeoutMs`. */
export const databaseTimeouts = (
  config: { readonly DB_LOCK_TIMEOUT_MS: number },
  transactionTimeoutMs: number,
  /** Worker handlers may wait for a lock as long as they may run: they are not interactive and a failed attempt costs a retry. */
  lockTimeoutMs: number = config.DB_LOCK_TIMEOUT_MS,
): Required<Pick<DatabaseScope, 'lockTimeoutMs' | 'statementTimeoutMs'>> => ({ lockTimeoutMs, statementTimeoutMs: transactionTimeoutMs });
