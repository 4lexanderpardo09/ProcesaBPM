import { Inject, Injectable } from '@nestjs/common';
import {
  type CreatePdfFormatRequest,
  DocumentSourceInUseError,
  NotFoundError,
  type Page,
  type PageQuery,
  PdfDesignInvalidError,
  type PdfFormatResponse,
  type UpdatePdfFormatRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PdfFormatRepository, type PdfFormatRow } from '../data/pdf-format.repository.js';
import { DocumentSourceValidator } from './document-source.validator.js';
import { toFormatResponse } from './document-responses.js';
import type { PdfDesign } from '@procesabpm/shared';

/** Admin of the designer formats of a workflow. A design is checked against the workflow's versions every time it is saved. */
@Injectable()
export class PdfFormatsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(PdfFormatRepository) private readonly formats: PdfFormatRepository,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
  ) {}

  list(workflowId: string, query: PageQuery): Promise<Page<PdfFormatResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const checker = await this.validator.forWorkflow(tx, this.tenantId, workflowId);
      const { rows, total } = await this.formats.list(tx, this.tenantId, workflowId, query);
      return toPage(rows, total, query, (row) => {
        const checked = checker.design(row.design as PdfDesign);
        return toFormatResponse(row, [...checked.errors, ...checked.warnings]);
      });
    });
  }

  get(workflowId: string, id: string): Promise<PdfFormatResponse> {
    return this.runner.withTenantTransaction((tx) => this.respond(tx, workflowId, id));
  }

  create(workflowId: string, request: CreatePdfFormatRequest): Promise<PdfFormatResponse> {
    const { tenantId, userId } = this.context.require();
    return this.runner.withTenantTransaction(async (tx) => {
      const checked = (await this.validator.forWorkflow(tx, tenantId, workflowId)).design(request.design);
      if (checked.errors.length > 0) throw new PdfDesignInvalidError(checked.errors);
      const row = await this.formats.create(tx, tenantId, workflowId, userId, { name: request.name, design: request.design, ...compact({ description: request.description, fileNamePattern: request.fileNamePattern }) });
      return toFormatResponse(row, checked.warnings);
    });
  }

  update(workflowId: string, id: string, request: UpdatePdfFormatRequest): Promise<PdfFormatResponse> {
    const { tenantId, userId } = this.context.require();
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      if (request.design !== undefined) {
        const checked = (await this.validator.forWorkflow(tx, tenantId, workflowId)).design(request.design);
        if (checked.errors.length > 0) throw new PdfDesignInvalidError(checked.errors);
      }
      await this.formats.update(tx, tenantId, workflowId, id, userId, compact(request));
      return this.respond(tx, workflowId, id);
    });
  }

  remove(workflowId: string, id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      if (await this.formats.isUsed(tx, this.tenantId, id)) throw new DocumentSourceInUseError();
      await this.formats.remove(tx, this.tenantId, workflowId, id);
    });
  }

  async require(tx: TenantTransaction, workflowId: string, id: string): Promise<PdfFormatRow> {
    const row = await this.formats.findById(tx, this.tenantId, workflowId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private async respond(tx: TenantTransaction, workflowId: string, id: string): Promise<PdfFormatResponse> {
    const row = await this.require(tx, workflowId, id);
    const checked = (await this.validator.forWorkflow(tx, this.tenantId, workflowId)).design(row.design as PdfDesign);
    return toFormatResponse(row, [...checked.errors, ...checked.warnings]);
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
