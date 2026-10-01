import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import { TenantContextMismatchError } from '@procesabpm/shared';
import { PrismaService } from './prisma.service.js';
import { TenantContext, type TenantScope } from './tenant-context.js';

export type TenantTransaction = Prisma.TransactionClient;

interface AppliedScope {
  tenant_id: string;
  user_id: string;
}

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
  ) {}

  /** Throws `MissingTenantContextError` when there is no tenant context: it never queries without one. */
  async withTenantTransaction<T>(work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const scope = this.tenantContext.require();
    return this.prisma.$transaction(async (tx) => {
      await this.applyScope(tx, scope);
      return work(tx);
    });
  }

  /**
   * The statement echoes the values it set. Checking them makes a mixed-up response (the failure
   * mode of prisma/orm#30374) stop the transaction before any tenant data is read or written.
   */
  private async applyScope(tx: TenantTransaction, scope: TenantScope): Promise<void> {
    const [applied] = await tx.$queryRaw<AppliedScope[]>`
      SELECT set_config('app.tenant_id', ${scope.tenantId}, true) AS tenant_id,
             set_config('app.user_id', ${scope.userId}, true) AS user_id`;
    if (applied?.tenant_id !== scope.tenantId || applied.user_id !== scope.userId) {
      throw new TenantContextMismatchError();
    }
  }
}
