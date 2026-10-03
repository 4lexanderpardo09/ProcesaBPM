import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateWorkflowRequest,
  NotFoundError,
  type Page,
  type UpdateWorkflowRequest,
  type WorkflowDetailResponse,
  type WorkflowResponse,
  type WorkflowsQuery,
  type WorkflowVersionDocument,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { VersionDocumentRepository } from '../data/version-document.repository.js';
import { type VersionRow, type WorkflowRow, WorkflowRepository } from '../data/workflow.repository.js';
import { toVersionSummary } from './version-summary.js';

const toResponse = (row: WorkflowRow): WorkflowResponse => ({ ...row, createdAt: row.createdAt.toISOString() });
const toDetail = (row: WorkflowRow, versions: readonly VersionRow[]): WorkflowDetailResponse => ({ ...toResponse(row), versions: versions.map(toVersionSummary) });

/** The canvas of a new workflow opens valid: START leads to END. */
export function startingDocument(ids: { start: string; end: string; transition: string }): WorkflowVersionDocument {
  const automatic = {
    description: null,
    assignmentMode: 'NONE' as const,
    manualSelection: false,
    siteScope: 'SAME_SITE' as const,
    positionId: null,
    approvalGroupTypeId: null,
    approvalLevel: null,
    closeRule: 'NOT_ALLOWED' as const,
    slaValue: null,
    slaUnit: null,
    deadlineType: 'SLA' as const,
    deadlineFieldCode: null,
    deadlineBusinessDays: null,
    maxLoops: null,
    dispatchIntervalMin: null,
    allowsBatch: false,
    config: {},
    candidates: [],
    initiators: [],
    slaOverrides: [],
    signers: [],
    files: [],
  };
  return {
    steps: [
      { ...automatic, id: ids.start, type: 'START', name: 'Inicio', ui: { x: 0, y: 0 } },
      { ...automatic, id: ids.end, type: 'END', name: 'Fin', ui: { x: 0, y: 200 } },
    ],
    transitions: [{ id: ids.transition, fromStepId: ids.start, toStepId: ids.end, type: 'DEFAULT', label: 'Continuar', condition: null, sortOrder: 0, uiPoints: null }],
    fields: [],
    amountRules: [],
  };
}

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowRepository) private readonly repository: WorkflowRepository,
    @Inject(VersionDocumentRepository) private readonly documents: VersionDocumentRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  list(query: WorkflowsQuery): Promise<Page<WorkflowResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<WorkflowDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => toDetail(await this.require(tx, id), await this.repository.listVersions(tx, this.tenantId, id)));
  }

  /** One workflow per subcategory (409 otherwise); a subcategory of another tenant is refused (422). It starts with a draft. */
  create(request: CreateWorkflowRequest): Promise<WorkflowDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const workflow = await this.repository.create(tx, this.tenantId, request);
      const version = await this.repository.createVersion(tx, this.tenantId, { workflowId: workflow.id, number: 1 });
      const [start, end, transition] = await this.documents.allocateIds(tx, 3);
      await this.documents.insertDocument(tx, this.tenantId, version.id, startingDocument({ start: start!, end: end!, transition: transition! }));
      await this.audit.record(tx, { action: 'workflow.created', subjectType: 'Workflow', subjectId: workflow.id, after: { name: workflow.name, subcategoryId: workflow.subcategoryId } });
      return toDetail(workflow, [version]);
    });
  }

  update(id: string, request: UpdateWorkflowRequest): Promise<WorkflowDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.repository.update(tx, this.tenantId, id, compact(request));
      const updated = await this.require(tx, id);
      await this.audit.record(tx, { action: 'workflow.updated', subjectType: 'Workflow', subjectId: id, before: { name: before.name, isActive: before.isActive }, after: { name: updated.name, isActive: updated.isActive } });
      return toDetail(updated, await this.repository.listVersions(tx, this.tenantId, id));
    });
  }

  private async require(tx: TenantTransaction, id: string): Promise<WorkflowRow> {
    const row = await this.repository.findById(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
