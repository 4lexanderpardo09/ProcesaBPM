import { Inject, Injectable } from '@nestjs/common';
import {
  AttachmentsInvalidError,
  InvalidStateError,
  NotFoundError,
  PDF_IMAGE_MIME_TYPES,
  PDF_LIMITS,
  PdfImageInUseError,
  type PdfImageResponse,
  type RegisterPdfImageRequest,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { PdfImageRepository, type PdfImageRow } from '../data/pdf-image.repository.js';
import { DocumentSourceValidator } from './document-source.validator.js';

/** Long enough to design a format; the editor asks again when they expire. */
const IMAGE_URL_TTL_SECONDS = 900;

/**
 * The images a workflow's canvas formats can show (seals, banners, stamps). An image is the caller's own confirmed
 * upload, referenced by the row; removing the row frees the file for the stale-upload purge, so an image a format
 * still shows cannot be removed.
 */
@Injectable()
export class PdfImagesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(PdfImageRepository) private readonly images: PdfImageRepository,
    @Inject(FileAttachmentService) private readonly attachments: FileAttachmentService,
    @Inject(DocumentSourceValidator) private readonly validator: DocumentSourceValidator,
  ) {}

  async list(workflowId: string): Promise<PdfImageResponse[]> {
    const rows = await this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, this.tenantId, workflowId);
      return this.images.list(tx, this.tenantId, workflowId);
    });
    return Promise.all(rows.map((row) => this.respond(row)));
  }

  async register(workflowId: string, request: RegisterPdfImageRequest): Promise<PdfImageResponse> {
    const { tenantId, userId } = this.context.require();
    const row = await this.runner.withTenantTransaction(async (tx) => {
      await this.validator.forWorkflow(tx, tenantId, workflowId);
      const own = await this.attachments.peekOwn(tx, tenantId, userId, request.fileId);
      if (own === null || !PDF_IMAGE_MIME_TYPES.includes(own.mimeType) || (await this.images.isRegistered(tx, tenantId, request.fileId))) {
        throw new AttachmentsInvalidError([{ fileId: request.fileId, code: 'FILE_NOT_ATTACHABLE' }]);
      }
      if ((await this.images.count(tx, tenantId, workflowId)) >= PDF_LIMITS.maxImagesPerWorkflow) throw new InvalidStateError(`A workflow keeps up to ${PDF_LIMITS.maxImagesPerWorkflow} images`);
      return this.images.create(tx, tenantId, { workflowId, fileId: request.fileId, name: request.name });
    });
    return this.respond(row);
  }

  remove(workflowId: string, id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      if ((await this.images.findById(tx, this.tenantId, workflowId, id)) === null) throw new NotFoundError();
      const formats = await this.images.formatsShowing(tx, this.tenantId, workflowId, id);
      if (formats.length > 0) throw new PdfImageInUseError(formats);
      await this.images.remove(tx, this.tenantId, workflowId, id);
    });
  }

  private async respond(row: PdfImageRow): Promise<PdfImageResponse> {
    const signed = await this.storage.presignDownload({ key: row.storageKey, fileName: row.name, contentType: row.mimeType, disposition: 'inline', expiresInSeconds: IMAGE_URL_TTL_SECONDS, now: this.clock.now() });
    return {
      id: row.id,
      workflowId: row.workflowId,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      createdAt: row.createdAt.toISOString(),
      url: signed.url,
      urlExpiresAt: signed.expiresAt.toISOString(),
    };
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
