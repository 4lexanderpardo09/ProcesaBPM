import { Injectable } from '@nestjs/common';
import type { AiJobStage, DraftPreview } from '@procesabpm/shared';
import type { CrossTenantTransaction, TenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

export interface AiJobClaim {
  readonly tenantId: string;
  readonly jobId: string;
  /** Presented by every later call: a worker whose lease expired cannot touch what the next owner does. */
  readonly claimToken: string;
  readonly attempt: number;
}

export interface AiJobProgress {
  readonly stage: AiJobStage;
  readonly round?: number;
  readonly problems?: number;
}

/** The worker side of ai_jobs: only through its functions (executable by app_worker only, docs/base-de-datos.md §8.32). */
@Injectable()
export class AiJobClaimsRepository {
  async claimDue(tx: CrossTenantTransaction, limit: number, leaseMinutes: number): Promise<AiJobClaim[]> {
    const rows = await tx.$queryRaw<Array<{ tenant_id: string; job_id: string; claim_token: string; attempt: number }>>`
      SELECT out_tenant_id::text AS tenant_id, out_job_id::text AS job_id, out_claim_token::text AS claim_token, out_attempt AS attempt
      FROM claim_due_ai_jobs(${limit}::int, make_interval(mins => ${leaseMinutes}::int))`;
    return rows.map((row) => ({ tenantId: row.tenant_id, jobId: row.job_id, claimToken: row.claim_token, attempt: row.attempt }));
  }

  async renew(tx: CrossTenantTransaction, claim: AiJobClaim, leaseMinutes: number): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT renew_ai_job_lease(${claim.tenantId}::uuid, ${claim.jobId}::uuid, ${claim.claimToken}::uuid, make_interval(mins => ${leaseMinutes}::int)) AS ok`;
    return row?.ok === true;
  }

  /** What the claimed attempt is doing now (the builder's panel shows it). `false`: not ours any more, stop. */
  async setStage(tx: CrossTenantTransaction, claim: AiJobClaim, progress: AiJobProgress): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT set_ai_job_stage(${claim.tenantId}::uuid, ${claim.jobId}::uuid, ${claim.claimToken}::uuid, ${progress.stage}::ai_job_stage, ${progress.round ?? null}::int, ${progress.problems ?? null}::int) AS ok`;
    return row?.ok === true;
  }

  /** The diagram so far of the round being designed. `false`: that round is over or the request is not ours: ignore. */
  async setPreview(tx: CrossTenantTransaction, claim: AiJobClaim, round: number, preview: DraftPreview): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT set_ai_job_preview(${claim.tenantId}::uuid, ${claim.jobId}::uuid, ${claim.claimToken}::uuid, ${round}::int, ${JSON.stringify(preview)}::jsonb) AS ok`;
    return row?.ok === true;
  }

  /** Called in the tenant transaction that writes the draft: `false` (not ours any more) must roll it back. */
  async finish(tx: TenantTransaction, claim: AiJobClaim, result: object): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT finish_ai_job(${claim.tenantId}::uuid, ${claim.jobId}::uuid, ${claim.claimToken}::uuid, ${JSON.stringify(result)}::jsonb) AS ok`;
    return row?.ok === true;
  }

  async fail(tx: CrossTenantTransaction, claim: AiJobClaim, errorCode: string): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT fail_ai_job(${claim.tenantId}::uuid, ${claim.jobId}::uuid, ${claim.claimToken}::uuid, ${errorCode}) AS ok`;
    return row?.ok === true;
  }
}
