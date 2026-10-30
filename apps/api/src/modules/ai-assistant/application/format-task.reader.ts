import { Inject, Injectable } from '@nestjs/common';
import { type FieldDocument, type PdfCanvasDesign, pdfCanvasDesignSchema } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DocumentSourceValidator } from '../../documents/application/document-source.validator.js';
import { PdfFormatRepository } from '../../documents/data/pdf-format.repository.js';
import { PdfImageRepository } from '../../documents/data/pdf-image.repository.js';
import { DraftCatalogRepository } from '../../workflows/data/draft-catalog.repository.js';
import { AiJobWorkRepository, type FormatJobInput } from '../data/ai-job-work.repository.js';
import type { FormatCatalog, FormatCatalogField, FormatTask } from '../domain/format-prompt.js';
import { PAST_TURN_LIMITS } from '../domain/prompt-builder.js';
import type { FormatCheck } from './format-designer.js';

export type ReadFormatTask =
  | { readonly kind: 'ready'; readonly input: FormatJobInput; readonly catalog: FormatCatalog; readonly task: FormatTask; readonly check: (design: PdfCanvasDesign) => FormatCheck }
  /** Ends the request before any paid call. */
  | { readonly kind: 'failed'; readonly errorCode: 'AI_JOB_INVALID' | 'AI_DISABLED' | 'FORMAT_GONE' };

const columnsOf = (field: FieldDocument): FormatCatalogField['columns'] =>
  Array.isArray(field.config.columns)
    ? (field.config.columns as Array<{ code?: unknown; label?: unknown; type?: unknown }>).flatMap((column) =>
        typeof column.code === 'string' ? [{ code: column.code, label: typeof column.label === 'string' ? column.label : column.code, type: typeof column.type === 'string' ? column.type : 'TEXT' }] : [],
      )
    : [];

/**
 * What a claimed format request asks the model, read in the tenant's transaction: the workflow's fields and steps
 * (published version first, as the save checks), its images and the organization's positions and approval types, and
 * the check a format saved by hand goes through. The format must still exist; a change starts from the design that was
 * on screen when it was asked (sent with the request: it may not be saved yet).
 */
@Injectable()
export class FormatTaskReader {
  constructor(
    @Inject(AiJobWorkRepository) private readonly work: AiJobWorkRepository,
    @Inject(PdfFormatRepository) private readonly formats: PdfFormatRepository,
    @Inject(PdfImageRepository) private readonly images: PdfImageRepository,
    @Inject(DraftCatalogRepository) private readonly catalogs: DraftCatalogRepository,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
  ) {}

  async read(tx: TenantTransaction, tenantId: string, jobId: string): Promise<ReadFormatTask> {
    const input = await this.work.formatInput(tx, tenantId, jobId);
    if (input === undefined) return { kind: 'failed', errorCode: 'AI_JOB_INVALID' };
    if (!input.enabled) return { kind: 'failed', errorCode: 'AI_DISABLED' };
    if ((await this.formats.findById(tx, tenantId, input.workflowId, input.formatId)) === null) return { kind: 'failed', errorCode: 'FORMAT_GONE' };
    const workflow = await tx.workflow.findFirst({ where: { tenantId, id: input.workflowId }, select: { name: true } });
    if (workflow === null) return { kind: 'failed', errorCode: 'FORMAT_GONE' };

    const checker = await this.validator.forWorkflow(tx, tenantId, input.workflowId);
    const organization = await this.catalogs.load(tx, tenantId);
    const catalog: FormatCatalog = {
      workflowName: workflow.name,
      fields: [...checker.document.fields].sort((a, b) => a.sortOrder - b.sortOrder).map((field) => ({ code: field.code, label: field.label, type: field.type, columns: columnsOf(field) })),
      steps: checker.document.steps.map((step) => ({ name: step.name, type: step.type })),
      images: (await this.images.list(tx, tenantId, input.workflowId)).map((image) => ({ id: image.id, name: image.name })),
      positions: organization.positions,
      approvalTypes: organization.approvalTypes,
    };
    const check = (design: PdfCanvasDesign): FormatCheck => checker.design(design);

    if (input.kind === 'PDF_FORMAT_DRAFT') return { kind: 'ready', input, catalog, task: { kind: 'create', description: input.description }, check };
    const basis = pdfCanvasDesignSchema.safeParse(input.basis);
    if (!basis.success) return { kind: 'failed', errorCode: 'AI_JOB_INVALID' };
    const history = await this.work.pastFormatRequests(tx, tenantId, input.formatId, { id: jobId, createdAt: input.createdAt }, PAST_TURN_LIMITS.turns);
    return { kind: 'ready', input, catalog, task: { kind: 'revise', message: input.description, basis: basis.data, history }, check };
  }
}
