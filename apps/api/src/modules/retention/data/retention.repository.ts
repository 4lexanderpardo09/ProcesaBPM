import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import type { ExpiredExportObject, RetentionRunClaim, RetentionRunSummary, TableRetentionStep } from '../domain/retention-step.js';

type DeletedRows = Array<{ deleted: number }>;

/** One batch of each step: the only way the worker can delete these rows (the functions are `app_worker`-only). */
const PURGE_BATCH: Readonly<Record<TableRetentionStep, (tx: CrossTenantTransaction, limit: number) => Promise<DeletedRows>>> = {
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
  /** Claims tonight's run for this replica, unless another one already started a run in the last 20 hours. */
  async startRun(tx: CrossTenantTransaction): Promise<RetentionRunClaim> {
    const [row] = await tx.$queryRaw<Array<{ run_id: string | null; blocking_started_at: Date | null }>>`
      SELECT out_run_id::text AS run_id, out_blocking_started_at AS blocking_started_at FROM retention_start_run()`;
    if (row?.run_id) return { kind: 'started', runId: row.run_id };
    if (row?.blocking_started_at) return { kind: 'skipped', blockingStartedAt: row.blocking_started_at };
    throw new Error('retention_start_run returned neither a run nor the run that blocks it');
  }

  /** Deletes at most `limit` rows of the step's table that are past its window; returns how many it deleted. */
  async purgeBatch(tx: CrossTenantTransaction, step: TableRetentionStep, limit: number): Promise<number> {
    const [row] = await PURGE_BATCH[step](tx, limit);
    return row?.deleted ?? 0;
  }

  /**
   * Marks READY exports past their expiry as EXPIRED and returns their objects, first those an earlier run could not
   * delete. The objects are deleted after this transaction commits.
   */
  async expireExports(tx: CrossTenantTransaction, limit: number): Promise<ExpiredExportObject[]> {
    const rows = await tx.$queryRaw<Array<{ tenant_id: string; export_id: string; storage_key: string }>>`
      SELECT out_tenant_id::text AS tenant_id, out_export_id::text AS export_id, out_storage_key AS storage_key FROM retention_expire_tenant_exports(${limit}::int)`;
    return rows.map((row) => ({ tenantId: row.tenant_id, exportId: row.export_id, storageKey: row.storage_key }));
  }

  async markExportObjectDeleted(tx: CrossTenantTransaction, object: ExpiredExportObject): Promise<void> {
    await tx.$queryRaw`SELECT retention_mark_export_object_deleted(${object.tenantId}::uuid, ${object.exportId}::uuid)`;
  }

  /** Writes the run's counts to the platform trail (`retention.run_finished`). */
  async finishRun(tx: CrossTenantTransaction, summary: RetentionRunSummary): Promise<void> {
    await tx.$executeRaw`SELECT retention_finish_run(${summary.runId}::uuid, ${JSON.stringify(summary.deleted)}::jsonb, ${[...summary.failed]}::text[], ${summary.durationMs}::int, ${summary.interrupted}::boolean)`;
  }
}
