import { Injectable } from '@nestjs/common';
import type { WorkflowsQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface WorkflowRow {
  readonly id: string;
  readonly subcategoryId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface VersionRow {
  readonly id: string;
  readonly workflowId: string;
  readonly number: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readonly notes: string | null;
  readonly revision: number;
  readonly publishedAt: Date | null;
  readonly publishedById: string | null;
  readonly createdAt: Date;
}

const WORKFLOW = { id: true, subcategoryId: true, name: true, isActive: true, createdAt: true } as const;
const VERSION = { id: true, workflowId: true, number: true, status: true, notes: true, revision: true, publishedAt: true, publishedById: true, createdAt: true } as const;

/**
 * Workflows and the headers of their versions. The lock queries serialize the writers: a publish takes the
 * workflow and then the version (always in that order), an edit takes only the version.
 */
@Injectable()
export class WorkflowRepository {
  async list(tx: TenantTransaction, tenantId: string, query: WorkflowsQuery): Promise<{ rows: WorkflowRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query), ...(query.subcategoryId === undefined ? {} : { subcategoryId: query.subcategoryId }) };
    const [rows, total] = await Promise.all([
      tx.workflow.findMany({ where, select: WORKFLOW, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      tx.workflow.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<WorkflowRow | null> {
    return tx.workflow.findFirst({ where: { tenantId, id }, select: WORKFLOW });
  }

  create(tx: TenantTransaction, tenantId: string, data: { subcategoryId: string; name: string }): Promise<WorkflowRow> {
    return tx.workflow.create({ data: { tenantId, ...data }, select: WORKFLOW });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.workflow.updateMany({ where: { tenantId, id }, data });
  }

  listVersions(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<VersionRow[]> {
    return tx.workflowVersion.findMany({ where: { tenantId, workflowId }, select: VERSION, orderBy: { number: 'desc' } });
  }

  findVersion(tx: TenantTransaction, tenantId: string, workflowId: string, versionId: string): Promise<VersionRow | null> {
    return tx.workflowVersion.findFirst({ where: { tenantId, workflowId, id: versionId }, select: VERSION });
  }

  /**
   * Serializes the creation and publication of versions of one workflow. `FOR NO KEY UPDATE` still excludes the
   * other writers of versions but lets inserts that only reference the workflow (tickets, observers…) go on.
   * Returns false when it does not exist.
   */
  async lockWorkflow(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM workflows WHERE tenant_id = ${tenantId}::uuid AND id = ${workflowId}::uuid FOR NO KEY UPDATE`;
    return rows.length > 0;
  }

  /**
   * Locks the version and returns its status (`undefined` when it is not a version of the workflow). An edit
   * takes `FOR SHARE`, which publishing (an update of the status) must wait for; whoever rewrites or deletes
   * the draft takes `FOR UPDATE`.
   */
  /**
   * Locks the version row `FOR UPDATE`, always. Every path that writes a version (edit, save, publish, delete) takes
   * this first: the immutability triggers read the row `FOR SHARE`, and a transaction that held SHARE and then
   * updated the row would deadlock with another one doing the same (both are share holders asking for an upgrade).
   */
  async lockVersion(tx: TenantTransaction, tenantId: string, workflowId: string, versionId: string): Promise<{ status: VersionRow['status']; revision: number } | undefined> {
    const rows = await tx.$queryRaw<Array<{ status: VersionRow['status']; revision: number }>>`SELECT status::text AS status, revision FROM workflow_versions WHERE tenant_id = ${tenantId}::uuid AND workflow_id = ${workflowId}::uuid AND id = ${versionId}::uuid FOR UPDATE`;
    return rows[0];
  }

  async bumpRevision(tx: TenantTransaction, tenantId: string, versionId: string): Promise<number> {
    const bumped = await tx.workflowVersion.update({ where: { tenantId_id: { tenantId, id: versionId } }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return bumped.revision;
  }

  async nextVersionNumber(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<number> {
    const latest = await tx.workflowVersion.aggregate({ where: { tenantId, workflowId }, _max: { number: true } });
    return (latest._max.number ?? 0) + 1;
  }

  createVersion(tx: TenantTransaction, tenantId: string, data: { workflowId: string; number: number; notes?: string }): Promise<VersionRow> {
    return tx.workflowVersion.create({ data: { tenantId, ...data }, select: VERSION });
  }

  async deleteVersion(tx: TenantTransaction, tenantId: string, versionId: string): Promise<void> {
    await tx.workflowVersion.deleteMany({ where: { tenantId, id: versionId } });
  }

  /** Archive the published one first: the unique index allows a single published version. */
  async archivePublished(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<void> {
    await tx.workflowVersion.updateMany({ where: { tenantId, workflowId, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
  }

  async publish(tx: TenantTransaction, tenantId: string, versionId: string, publishedById: string, notes?: string): Promise<number> {
    const { count } = await tx.workflowVersion.updateMany({
      where: { tenantId, id: versionId, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedById, ...(notes === undefined ? {} : { notes }) },
    });
    return count;
  }
}
