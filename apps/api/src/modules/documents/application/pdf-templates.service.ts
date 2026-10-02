import { Inject, Injectable } from '@nestjs/common';
import {
  AttachmentsInvalidError,
  type DownloadUrlResponse,
  DocumentSourceInUseError,
  NotFoundError,
  type Page,
  type PageQuery,
  PdfMappingInvalidError,
  type PdfTemplateResponse,
  type RegisterPdfTemplateRequest,
  type TemplateMapping,
  type TemplateMappingResponse,
  type UpdatePdfTemplateRequest,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PdfInspector } from '../../../infrastructure/pdf/pdf-renderer.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { PdfTemplateRepository, type PdfTemplateRow } from '../data/pdf-template.repository.js';
import { DocumentSourceValidator } from './document-source.validator.js';
import { toProblemResponses, toTemplateResponse } from './document-responses.js';

const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024 + 1;
const DOWNLOAD_TTL_SECONDS = 120;

/** Admin of the PDFs a customer uploads to be filled, and of where each value goes in them. */
@Injectable()
export class PdfTemplatesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(PdfInspector) private readonly inspector: PdfInspector,
    @Inject(PdfTemplateRepository) private readonly templates: PdfTemplateRepository,
    @Inject(FileAttachmentService) private readonly attachments: FileAttachmentService,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
  ) {}

  list(workflowId: string, query: PageQuery): Promise<Page<PdfTemplateResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, this.tenantId, workflowId);
      const { rows, total } = await this.templates.list(tx, this.tenantId, workflowId, query);
      return toPage(rows, total, query, toTemplateResponse);
    });
  }

  get(workflowId: string, id: string): Promise<PdfTemplateResponse> {
    return this.runner.withTenantTransaction(async (tx) => toTemplateResponse(await this.require(tx, workflowId, id)));
  }

  /**
   * Registers a confirmed upload as a template. The PDF is read and inspected with no transaction open (it is a network
   * call and real work); the file is locked again before it is linked, because it could have been used meanwhile.
   */
  async register(workflowId: string, request: RegisterPdfTemplateRequest): Promise<PdfTemplateResponse> {
    const { tenantId, userId } = this.context.require();
    const file = await this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, tenantId, workflowId);
      if (request.companyId !== undefined && (await tx.company.count({ where: { tenantId, id: request.companyId } })) === 0) throw new NotFoundError();
      const own = await this.attachments.peekOwn(tx, tenantId, userId, request.fileId);
      if (own === null || own.mimeType !== 'application/pdf') throw new AttachmentsInvalidError([{ fileId: request.fileId, code: 'FILE_NOT_ATTACHABLE' }]);
      return own;
    });
    const inspected = await this.inspector.inspect(await this.storage.read(file.storageKey, TEMPLATE_MAX_BYTES));
    return this.runner.withTenantTransaction(async (tx) => {
      const [locked] = await this.attachments.lockAttachable(tx, tenantId, userId, [request.fileId]);
      if (locked === undefined) throw new AttachmentsInvalidError([{ fileId: request.fileId, code: 'FILE_NOT_ATTACHABLE' }]);
      const row = await this.templates.create(tx, tenantId, { workflowId, companyId: request.companyId ?? null, fileId: request.fileId, name: request.name, pages: inspected.pages, acroformFields: inspected.acroformFields });
      await this.attachments.linkStandalone(tx, tenantId, [request.fileId], request.companyId ?? null, this.clock.now());
      return toTemplateResponse(row);
    });
  }

  update(workflowId: string, id: string, request: UpdatePdfTemplateRequest): Promise<PdfTemplateResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      await this.templates.update(tx, this.tenantId, workflowId, id, compact(request));
      return toTemplateResponse(await this.require(tx, workflowId, id));
    });
  }

  remove(workflowId: string, id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, workflowId, id);
      if (await this.templates.isUsed(tx, this.tenantId, id)) throw new DocumentSourceInUseError();
      await this.templates.remove(tx, this.tenantId, workflowId, id);
    });
  }

  getMapping(workflowId: string, id: string): Promise<TemplateMappingResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const template = await this.require(tx, workflowId, id);
      const mapping = await this.templates.mapping(tx, this.tenantId, id);
      const checked = (await this.validator.forWorkflow(tx, this.tenantId, workflowId)).mapping(mapping, template);
      return { mapping, warnings: toProblemResponses([...checked.errors, ...checked.warnings]) };
    });
  }

  putMapping(workflowId: string, id: string, mapping: TemplateMapping): Promise<TemplateMappingResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const template = await this.require(tx, workflowId, id);
      const checked = (await this.validator.forWorkflow(tx, this.tenantId, workflowId)).mapping(mapping, template);
      if (checked.errors.length > 0) throw new PdfMappingInvalidError(checked.errors);
      await this.templates.replaceMapping(tx, this.tenantId, id, mapping);
      return { mapping: await this.templates.mapping(tx, this.tenantId, id), warnings: toProblemResponses(checked.warnings) };
    });
  }

  /** A short-lived URL of the uploaded PDF, for the editor that shows the page under the placed fields. */
  async downloadUrl(workflowId: string, id: string): Promise<DownloadUrlResponse> {
    const { template, storageKey } = await this.runner.withTenantTransaction(async (tx) => {
      const row = await this.require(tx, workflowId, id);
      const key = await this.templates.storageKeyOf(tx, this.tenantId, row.fileId);
      if (key === null) throw new NotFoundError();
      return { template: row, storageKey: key };
    });
    const signed = await this.storage.presignDownload({ key: storageKey, fileName: `${template.name}.pdf`, contentType: 'application/pdf', disposition: 'inline', expiresInSeconds: DOWNLOAD_TTL_SECONDS, now: this.clock.now() });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async require(tx: TenantTransaction, workflowId: string, id: string): Promise<PdfTemplateRow> {
    const row = await this.templates.findById(tx, this.tenantId, workflowId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
