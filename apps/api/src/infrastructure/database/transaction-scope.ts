import type { Prisma } from '@procesabpm/db';

declare const transactionScope: unique symbol;
type ScopedTransaction<S extends string> = Prisma.TransactionClient & { readonly [transactionScope]: S };

/** Runtime or worker login, RLS on, `app.tenant_id` fixed: an API request or a worker job on one tenant. */
export type TenantTransaction = ScopedTransaction<'tenant'>;
/** Runtime login, no tenant: the `auth_*` functions and the user's own `refresh_sessions`. */
export type AuthTransaction = ScopedTransaction<'auth'>;
/** Worker login, no tenant: only the worker's cross-tenant `SECURITY DEFINER` functions (claims, purges). */
export type CrossTenantTransaction = ScopedTransaction<'cross-tenant'>;
/** Platform login (BYPASSRLS): every tenant row must carry an explicit tenant_id. */
export type PlatformTransaction = ScopedTransaction<'platform'>;

/** Only the runners call this, right after the scope was applied. The brand has no runtime value. */
export function asScoped<T extends TenantTransaction | AuthTransaction | CrossTenantTransaction | PlatformTransaction>(
  tx: Prisma.TransactionClient,
): T {
  return tx as T;
}
