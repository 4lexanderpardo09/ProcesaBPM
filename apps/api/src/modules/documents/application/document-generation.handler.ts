import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PDF_LIMITS, StorageUnavailableError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { type ClaimedEvent, type ExternalEffectHandler, PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { PdfRenderer } from '../../../infrastructure/pdf/pdf-renderer.js';
import type { RenderedPdf } from '../../../infrastructure/pdf/pdf-renderer.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { buildStorageKey } from '../../files/domain/storage-key.js';
import { SystemFileService } from '../../files/application/system-file.service.js';
import { TicketDocumentRepository } from '../../files/data/ticket-document.repository.js';
import { DocumentSourceRepository } from '../data/document-source.repository.js';
import { deriveGeneratedFileId } from '../domain/derive-file-id.js';
import { planRender, type RenderPlan } from '../domain/render-plan.js';
import { type DocumentGeneratePayload, DOCUMENT_GENERATE_EVENT, documentGeneratePayloadSchema } from './document-generate.payload.js';
import { ImageLoader } from './image-loader.js';
import { RenderFactsLoader } from './render-facts.loader.js';

const PDF_MIME_TYPE = 'application/pdf';
const TEMPLATE_MAX_BYTES = 4 * 1024 * 1024 + 1;

/** What `prepare` decided to draw: plain data plus the storage keys to read, never bytes. */
export interface PreparedDocument {
  readonly plan: RenderPlan;
  readonly fileId: string;
  readonly storageKey: string;
  readonly imageStorageKeys: ReadonlyMap<string, string>;
}

export interface GeneratedPdf {
  readonly fileId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/**
 * Draws a ticket's document with the pdf engine and stores it as a new version. It is safe to repeat: the file id (and so
 * the storage key) is derived from the outbox event, an object already at the key is reused, and recording the result is
 * a no-op for a file that is already recorded. It skips, rather than fails, when what it should draw is gone or switched
 * off since the event was queued.
 */
@Injectable()
export class DocumentGenerationHandler implements ExternalEffectHandler<DocumentGeneratePayload, PreparedDocument, GeneratedPdf>, OnModuleInit {
  readonly type = DOCUMENT_GENERATE_EVENT;
  readonly scope = 'tenant' as const;
  readonly schema = documentGeneratePayloadSchema;

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(PdfRenderer) private readonly renderer: PdfRenderer,
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(DocumentSourceRepository) private readonly sources: DocumentSourceRepository,
    @Inject(RenderFactsLoader) private readonly factsLoader: RenderFactsLoader,
    @Inject(ImageLoader) private readonly imageLoader: ImageLoader,
    @Inject(TicketDocumentRepository) private readonly ticketDocuments: TicketDocumentRepository,
    @Inject(SystemFileService) private readonly systemFiles: SystemFileService,
  ) {}

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: TenantTransaction, event: ClaimedEvent<DocumentGeneratePayload>): Promise<PreparedDocument | null> {
    const tenantId = event.tenantId!;
    const { payload } = event;
    const fileId = deriveGeneratedFileId(tenantId, event.id);
    if (await this.ticketDocuments.existsForFile(tx, tenantId, fileId)) return null;

    const source = await this.sources.findWorkflowDocument(tx, tenantId, payload.workflowDocumentId);
    const loaded = await this.factsLoader.load(tx, tenantId, payload.ticketId, this.clock.now());
    if (source === null || loaded === null) return this.skip(event, 'the document or the ticket no longer exists');
    if (!isUsable(source, loaded.workflowId, loaded.companyId)) return this.skip(event, 'the document is switched off or does not apply to this ticket');
    return { plan: planOrFail(source, loaded.facts), fileId, storageKey: buildStorageKey(tenantId, fileId, event.createdAt), imageStorageKeys: loaded.imageStorageKeys };
  }

  async perform(prepared: PreparedDocument, event: ClaimedEvent<DocumentGeneratePayload>): Promise<GeneratedPdf> {
    const existing = await this.storage.head(prepared.storageKey);
    const stored = existing === null ? await this.renderAndStore(prepared, event) : await this.readBack(prepared.storageKey);
    return { fileId: prepared.fileId, storageKey: prepared.storageKey, fileName: prepared.plan.fileName, sizeBytes: stored.length, sha256: sha256Of(stored) };
  }

  async record(tx: TenantTransaction, result: GeneratedPdf, event: ClaimedEvent<DocumentGeneratePayload>): Promise<void> {
    const { payload } = event;
    await this.systemFiles.recordGeneratedDocument(tx, event.tenantId!, {
      ...result,
      mimeType: PDF_MIME_TYPE,
      ticketId: payload.ticketId,
      role: payload.role,
      stepId: payload.stepId,
      eventId: payload.ticketEventId,
      at: event.createdAt,
    });
  }

  private skip(event: ClaimedEvent<DocumentGeneratePayload>, reason: string): null {
    this.logger.warn({ message: `Document not generated: ${reason}`, eventId: event.id, tenantId: event.tenantId, workflowDocumentId: event.payload.workflowDocumentId }, 'DocumentGenerationHandler');
    return null;
  }

  private async renderAndStore(prepared: PreparedDocument, event: ClaimedEvent<DocumentGeneratePayload>): Promise<Uint8Array> {
    const rendered = await this.render(prepared, event);
    if (rendered.pageCount > PDF_LIMITS.maxPages) throw new PermanentEventError('The document has too many pages');
    if (rendered.bytes.length > this.settings.PDF_MAX_OUTPUT_BYTES) throw new PermanentEventError('The document is too large');
    const outcome = await this.storage.put({ key: prepared.storageKey, body: rendered.bytes, contentType: PDF_MIME_TYPE });
    // Somebody (an earlier attempt that crashed before recording) wrote it first: that object is the document.
    return outcome === 'created' ? rendered.bytes : this.readBack(prepared.storageKey);
  }

  private readBack(key: string): Promise<Uint8Array> {
    return this.storage.read(key, this.settings.PDF_MAX_OUTPUT_BYTES);
  }

  private async render(prepared: PreparedDocument, event: ClaimedEvent<DocumentGeneratePayload>): Promise<RenderedPdf> {
    const images = await this.imageLoader.load(prepared.plan.imageKeys, prepared.imageStorageKeys);
    const deadlineAt = Date.now() + this.settings.PDF_RENDER_TIMEOUT_MS;
    const meta = { title: prepared.plan.fileName, createdAt: event.createdAt };
    const { plan } = prepared;
    try {
      if (plan.kind === 'DESIGN') return await this.renderer.renderDesign({ ...plan.job, images, deadlineAt, meta });
      const template = await this.storage.read(plan.templateStorageKey, TEMPLATE_MAX_BYTES);
      return await this.renderer.fillTemplate({ template, ...plan.job, images, deadlineAt, meta });
    } catch (error) {
      // Drawing is deterministic: the same input fails the same way, so retrying only delays the answer.
      if (error instanceof StorageUnavailableError) throw error;
      const cause = error instanceof Error ? error.name : 'Error';
      throw new PermanentEventError(`The document could not be drawn (${cause})`);
    }
  }
}

/** Inactive sources, other companies' documents and a template whose file is not confirmed are not drawn. */
function isUsable(source: NonNullable<Awaited<ReturnType<DocumentSourceRepository['findWorkflowDocument']>>>, ticketWorkflowId: string, ticketCompanyId: string): boolean {
  if (!source.isActive || source.workflowId !== ticketWorkflowId) return false;
  if (source.companyId !== null && source.companyId !== ticketCompanyId) return false;
  if (source.kind === 'DESIGNED') return source.format?.isActive === true;
  return source.template?.isActive === true && source.template.fileConfirmed;
}

function planOrFail(source: Parameters<typeof planRender>[0], facts: Parameters<typeof planRender>[1]): RenderPlan {
  try {
    return planRender(source, facts);
  } catch (error) {
    throw new PermanentEventError(`The document definition is not valid (${error instanceof Error ? error.name : 'Error'})`);
  }
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
