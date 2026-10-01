import type { Prisma } from '@procesabpm/db';
import { TenantContextMismatchError } from '@procesabpm/shared';

/** Values of `app.tenant_id` / `app.user_id`; an empty string means "not set" for the database. */
export interface DatabaseScope {
  readonly tenantId: string;
  readonly userId: string;
}

interface AppliedScope {
  tenant_id: string;
  user_id: string;
}

/**
 * Sets both settings as transaction-local (docs/base-de-datos.md §6.2). The statement echoes the
 * values it set; checking them makes a mixed-up response (the failure mode of prisma/orm#30374)
 * stop the transaction before any data is read or written.
 */
export async function applyDatabaseScope(tx: Prisma.TransactionClient, scope: DatabaseScope): Promise<void> {
  const [applied] = await tx.$queryRaw<AppliedScope[]>`
    SELECT set_config('app.tenant_id', ${scope.tenantId}, true) AS tenant_id,
           set_config('app.user_id', ${scope.userId}, true) AS user_id`;
  if (applied?.tenant_id !== scope.tenantId || applied.user_id !== scope.userId) {
    throw new TenantContextMismatchError();
  }
}
