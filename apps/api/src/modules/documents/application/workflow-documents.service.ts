import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateWorkflowDocumentRequest,
  DocumentSourceInUseError,
  NotFoundError,
  type Page,
  type PageQuery,
  type UpdateWorkflowDocumentRequest,
  type WorkflowDocumentResponse,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PdfFormatRepository } from '../data/pdf-format.repository.js';
import { PdfTemplateRepository } from '../data/pdf-template.repository.js';
import { WorkflowDocumentRepository, type WorkflowDocumentRow } from '../data/workflow-document.repository.js';
import { DocumentSourceValidator } from './document-source.validator.js';
import { toWorkflowDocumentResponse } from './document-responses.js';

/** Which document a workflow produces, for whom and when. The database keeps one active document per company and moment. */
@Injectable()
export class WorkflowDocumentsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(WorkflowDocumentRepository) private readonly documents: WorkflowDocumentRepository,
    @Inject(PdfFormatRepository) private readonly formats: PdfFormatRepository,
    @Inject(PdfTemplateRepository) private readonly templates: PdfTemplateRepository,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
  ) {}

  list(workflowId: string, query: PageQuery): Promise<Page<WorkflowDocumentResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, this.tenantId, workflowId);
      const { rows, total } = await this.documents.list(tx, this.tenantId, workflowId, query);
      return toPage(rows, total, query, toWorkflowDocumentResponse);
    });
  }

  get(workflowId: string, id: string): Promise<WorkflowDocumentResponse> {
    return this.runner.withTenantTransaction(async (tx) => toWorkflowDocumentResponse(await this.require(tx, workflowId, id)));
  }

  create(workflowId: string, request: CreateWorkflowDocumentRequest): Promise<WorkflowDocumentResponse> {
    const tenantId = this.tenantId;
    return this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, tenantId, workflowId);
      if (request.formatId !== undefined && (await this.formats.findById(tx, tenantId, workflowId, request.formatId)) === null) throw new NotFoundError();
      if (request.templateId !== undefined && (await this.templates.findById(tx, tenantId, workflowId, request.templateId)) === null) throw new NotFoundError();
      if (request.companyId !== undefined && (await tx.company.count({ where: { tenantId, id: request.companyId } })) === 0) throw new NotFoundError();
      const row = await this.documents.create(tx, tenantId, { workflowId, companyId: request.companyId ?? null, formatId: request.formatId ?? null, templateId: request.templateId ?? null, moment: request.moment });
      return toWorkflowDocumentResponse(row);
    });
  }

  update(workflowId: string, id: string, request: UpdateWorkflowDocumentRequest): Promise<WorkflowDocumentResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      await this.documents.update(tx, this.tenantId, workflowId, id, compact(request));
      return toWorkflowDocumentResponse(await this.require(tx, workflowId, id));
    });
  }

  remove(workflowId: string, id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      if (await this.documents.isReferencedByBlock(tx, this.tenantId, workflowId, id)) throw new DocumentSourceInUseError();
      await this.documents.remove(tx, this.tenantId, workflowId, id);
    });
  }

  private async require(tx: TenantTransaction, workflowId: string, id: string): Promise<WorkflowDocumentRow> {
    const row = await this.documents.findById(tx, this.tenantId, workflowId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
