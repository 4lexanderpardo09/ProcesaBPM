import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

export interface PurgeClaim {
  readonly tenantId: string;
  /** The token the later calls present: a worker whose claim expired cannot touch what the new owner is doing. */
  readonly attempt: number;
}

/** The three worker functions of the purge. Nothing else of a deleted tenant is reachable from the worker. */
@Injectable()
export class TenantPurgeRepository {
  async claimDue(tx: CrossTenantTransaction, limit: number, leaseMinutes: number): Promise<PurgeClaim[]> {
    const rows = await tx.$queryRaw<Array<{ out_tenant_id: string; out_attempt: number }>>`
      SELECT out_tenant_id::text AS out_tenant_id, out_attempt FROM claim_due_tenant_purges(${limit}::int, make_interval(mins => ${leaseMinutes}::int))`;
    return rows.map((row) => ({ tenantId: row.out_tenant_id, attempt: row.out_attempt }));
  }

  /** Removes the data and leaves the tombstone, in one transaction. `false`: nothing to do (not due, or not ours any more). */
  async finish(tx: CrossTenantTransaction, claim: PurgeClaim): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT finish_tenant_purge(${claim.tenantId}::uuid, ${claim.attempt}::int) AS ok`;
    return row?.ok === true;
  }

  async fail(tx: CrossTenantTransaction, claim: PurgeClaim, error: string, retryAt: Date): Promise<void> {
    await tx.$queryRaw`SELECT fail_tenant_purge(${claim.tenantId}::uuid, ${claim.attempt}::int, ${error}, ${retryAt}::timestamptz)`;
  }
}
