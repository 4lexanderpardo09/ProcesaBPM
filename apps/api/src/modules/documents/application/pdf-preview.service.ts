import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PdfRenderFailedError, type PreviewRequest, type WorkflowVersionDocument } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner, type TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { PdfRenderer } from '../../../infrastructure/pdf/pdf-renderer.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { DocumentSourceRepository, type WorkflowDocumentSource } from '../data/document-source.repository.js';
import { PdfFormatRepository } from '../data/pdf-format.repository.js';
import { PdfTemplateRepository } from '../data/pdf-template.repository.js';
import { RenderFactsRepository } from '../data/render-facts.repository.js';
import { buildPreviewFacts } from '../domain/preview-facts.js';
import { planRender, type RenderPlan } from '../domain/render-plan.js';
import { DocumentSourceValidator } from './document-source.validator.js';
import { ImageLoader } from './image-loader.js';

const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024 + 1;
const PREVIEW_TIMEOUT_MS = 10_000;

export interface PreviewPdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

interface Prepared {
  readonly plan: RenderPlan;
  readonly logoKey: string | null;
}

/** Draws a format or a template with sample data so the editor can show the result. Nothing is stored. */
@Injectable()
export class PdfPreviewService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(PdfRenderer) private readonly renderer: PdfRenderer,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
    @Inject(PdfFormatRepository) private readonly formats: PdfFormatRepository,
    @Inject(PdfTemplateRepository) private readonly templates: PdfTemplateRepository,
    @Inject(DocumentSourceRepository) private readonly sources: DocumentSourceRepository,
    @Inject(RenderFactsRepository) private readonly facts: RenderFactsRepository,
    @Inject(ImageLoader) private readonly imageLoader: ImageLoader,
  ) {}

  async previewFormat(workflowId: string, formatId: string, request: PreviewRequest): Promise<PreviewPdf> {
    const prepared = await this.runner.withTenantTransaction(async (tx) => {
      const format = await this.formats.findById(tx, this.tenantId, workflowId, formatId);
      if (format === null) throw new NotFoundError();
      return this.prepare(tx, workflowId, request, { id: formatId, workflowId, companyId: null, kind: 'DESIGNED', moment: null, isActive: true, format, template: null });
    });
    return this.draw(prepared);
  }

  async previewTemplate(workflowId: string, templateId: string, request: PreviewRequest): Promise<PreviewPdf> {
    const prepared = await this.runner.withTenantTransaction(async (tx) => {
      const row = await this.templates.findById(tx, this.tenantId, workflowId, templateId);
      if (row === null) throw new NotFoundError();
      const key = await this.templates.storageKeyOf(tx, this.tenantId, row.fileId);
      if (key === null) throw new NotFoundError();
      const mapping = await this.sources.templateMapping(tx, this.tenantId, templateId);
      return this.prepare(tx, workflowId, request, { id: templateId, workflowId, companyId: null, kind: 'TEMPLATE', moment: null, isActive: true, format: null, template: { id: templateId, name: row.name, isActive: true, storageKey: key, fileConfirmed: true, ...mapping } });
    });
    return this.draw(prepared);
  }

  private async prepare(tx: TenantTransaction, workflowId: string, request: PreviewRequest, source: WorkflowDocumentSource): Promise<Prepared> {
    const tenantId = this.tenantId;
    const checker = await this.validator.forWorkflow(tx, tenantId, workflowId);
    const document: WorkflowVersionDocument = checker.document;
    const known = new Set(document.fields.map((field) => field.code));
    const overrides = Object.fromEntries(Object.entries(request.values).filter(([code]) => known.has(code)));
    const locale = await this.sources.tenantLocale(tx, tenantId);
    const facts = buildPreviewFacts(document.fields, document.steps, overrides, locale, this.clock.now());
    const plan = planRender(source, facts);
    const logoFileId = plan.imageKeys.has('logo') ? await this.facts.logoFileId(tx, tenantId) : null;
    const logoKey = logoFileId === null ? null : ((await this.facts.imageKeys(tx, tenantId, [logoFileId])).get(logoFileId) ?? null);
    return { plan, logoKey };
  }

  private async draw({ plan, logoKey }: Prepared): Promise<PreviewPdf> {
    const images = await this.imageLoader.load(plan.imageKeys, new Map(logoKey === null ? [] : [['logo', logoKey]]));
    const deadlineAt = Date.now() + PREVIEW_TIMEOUT_MS;
    const meta = { title: plan.fileName, createdAt: this.clock.now() };
    try {
      const rendered =
        plan.kind === 'DESIGN'
          ? await this.renderer.renderDesign({ ...plan.job, images, deadlineAt, meta })
          : await this.renderer.fillTemplate({ template: await this.storage.read(plan.templateStorageKey, TEMPLATE_MAX_BYTES), ...plan.job, images, deadlineAt, meta });
      return { bytes: rendered.bytes, fileName: plan.fileName };
    } catch (error) {
      throw new PdfRenderFailedError({ cause: error });
    }
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
