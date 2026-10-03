import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { RetentionRunSummary, RetentionStep } from '../domain/retention-step.js';

type DeletedRows = Array<{ deleted: number }>;

/** One batch of each step: the only way the worker can delete these rows (the functions are `app_worker`-only). */
const PURGE_BATCH: Readonly<Record<RetentionStep, (tx: CrossTenantTransaction, limit: number) => Promise<DeletedRows>>> = {
  outbox_events: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_outbox_events(${limit}::int) AS deleted`,
  platform_outbox_events: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_platform_outbox_events(${limit}::int) AS deleted`,
  notifications: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_notifications(${limit}::int) AS deleted`,
  refresh_sessions: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_refresh_sessions(${limit}::int) AS deleted`,
  user_tokens: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_user_tokens(${limit}::int) AS deleted`,
  audit_logs: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_audit_logs(${limit}::int) AS deleted`,
  support_sessions: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_support_sessions(${limit}::int) AS deleted`,
  support_access_grants: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_support_access_grants(${limit}::int) AS deleted`,
  platform_audit_logs: (tx, limit) => tx.$queryRaw<DeletedRows>`SELECT retention_purge_platform_audit_logs(${limit}::int) AS deleted`,
};

@Injectable()
export class RetentionRepository {
  /** Claims tonight's run for this replica; `null` when another one already started a run in the last 20 hours. */
  async startRun(tx: CrossTenantTransaction): Promise<string | null> {
    const [row] = await tx.$queryRaw<Array<{ run_id: string | null }>>`SELECT retention_start_run()::text AS run_id`;
    return row?.run_id ?? null;
  }

  /** Deletes at most `limit` rows of the step's table that are past its window; returns how many it deleted. */
  async purgeBatch(tx: CrossTenantTransaction, step: RetentionStep, limit: number): Promise<number> {
    const [row] = await PURGE_BATCH[step](tx, limit);
    return row?.deleted ?? 0;
  }

  /** Writes the run's counts to the platform trail (`retention.run_finished`). */
  async finishRun(tx: CrossTenantTransaction, summary: RetentionRunSummary): Promise<void> {
    await tx.$executeRaw`SELECT retention_finish_run(${summary.runId}::uuid, ${JSON.stringify(summary.deleted)}::jsonb, ${[...summary.failed]}::text[], ${summary.durationMs}::int)`;
  }
}
