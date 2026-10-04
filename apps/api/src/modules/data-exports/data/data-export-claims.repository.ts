import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

export interface ExportClaim {
  readonly tenantId: string;
  readonly exportId: string;
  readonly includeFiles: boolean;
  /** Presented by every later call: a worker whose lease expired cannot touch what the next owner does. */
  readonly claimToken: string;
  readonly attempt: number;
}

export interface FinishedExport {
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly counts: Readonly<Record<string, number>>;
}

/** The worker side of tenant_data_exports: only through its functions (executable by app_worker only, §8.31). */
@Injectable()
export class DataExportClaimsRepository {
  async claimDue(tx: CrossTenantTransaction, limit: number, leaseMinutes: number): Promise<ExportClaim[]> {
    const rows = await tx.$queryRaw<Array<{ tenant_id: string; export_id: string; include_files: boolean; claim_token: string; attempt: number }>>`
      SELECT out_tenant_id::text AS tenant_id, out_export_id::text AS export_id, out_include_files AS include_files,
             out_claim_token::text AS claim_token, out_attempt AS attempt
      FROM claim_due_tenant_exports(${limit}::int, make_interval(mins => ${leaseMinutes}::int))`;
    return rows.map((row) => ({ tenantId: row.tenant_id, exportId: row.export_id, includeFiles: row.include_files, claimToken: row.claim_token, attempt: row.attempt }));
  }

  async renew(tx: CrossTenantTransaction, claim: ExportClaim, leaseMinutes: number): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT renew_tenant_export_lease(${claim.tenantId}::uuid, ${claim.exportId}::uuid, ${claim.claimToken}::uuid, make_interval(mins => ${leaseMinutes}::int)) AS ok`;
    return row?.ok === true;
  }

  /** READY, and the ready e-mail queued in the same transaction. `false`: not ours any more, or the purge is due. */
  async finish(tx: CrossTenantTransaction, claim: ExportClaim, result: FinishedExport): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT finish_tenant_export(${claim.tenantId}::uuid, ${claim.exportId}::uuid, ${claim.claimToken}::uuid, ${result.sizeBytes}::bigint,
                                  ${result.sha256}, ${JSON.stringify(result.counts)}::jsonb) AS ok`;
    return row?.ok === true;
  }

  /** `retryAt` null: FAILED for good. */
  async fail(tx: CrossTenantTransaction, claim: ExportClaim, errorCode: string, retryAt: Date | null): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT fail_tenant_export(${claim.tenantId}::uuid, ${claim.exportId}::uuid, ${claim.claimToken}::uuid, ${errorCode}, ${retryAt}::timestamptz) AS ok`;
    return row?.ok === true;
  }
}
