import { Inject, Injectable } from '@nestjs/common';
import { AttachmentsInvalidError, PDF_IMAGE_MIME_TYPES, type SetTenantLogoRequest, type TenantLogoResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { TenantLogoRepository } from '../data/tenant-logo.repository.js';

const LOGO_URL_TTL_SECONDS = 900;

/**
 * The organization's logo, which the PDF formats draw. It is one of the caller's own confirmed PNG or JPEG uploads,
 * referenced by the tenant (not linked): the one it replaces is no longer held by anything, so the stale-upload purge
 * removes it.
 */
@Injectable()
export class TenantLogoService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(TenantLogoRepository) private readonly logos: TenantLogoRepository,
    @Inject(FileAttachmentService) private readonly attachments: FileAttachmentService,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
  ) {}

  /** A short-lived URL of the logo, or null when the organization has none. */
  async get(): Promise<TenantLogoResponse | null> {
    const { tenantId } = this.context.require();
    const file = await this.runner.withTenantTransaction((tx) => this.logos.find(tx, tenantId));
    if (file === null) return null;
    const signed = await this.storage.presignDownload({ key: file.storageKey, fileName: 'logo', contentType: file.mimeType, disposition: 'inline', expiresInSeconds: LOGO_URL_TTL_SECONDS, now: this.clock.now() });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async set(request: SetTenantLogoRequest): Promise<TenantLogoResponse> {
    const { tenantId, userId } = this.context.require();
    await this.runner.withTenantTransaction(async (tx) => {
      const own = await this.attachments.peekOwn(tx, tenantId, userId, request.fileId);
      if (own === null || !PDF_IMAGE_MIME_TYPES.includes(own.mimeType)) throw new AttachmentsInvalidError([{ fileId: request.fileId, code: 'FILE_NOT_ATTACHABLE' }]);
      const previous = await this.logos.find(tx, tenantId);
      await this.logos.set(tx, tenantId, request.fileId);
      await this.audit.record(tx, { action: 'tenant.logo_updated', subjectType: 'Setting', subjectId: tenantId, before: { fileId: previous?.id ?? null }, after: { fileId: request.fileId } });
    });
    return (await this.get())!;
  }

  /** Idempotent; recorded even when there was no logo, as every answered change of a setting is. */
  remove(): Promise<void> {
    const { tenantId } = this.context.require();
    return this.runner.withTenantTransaction(async (tx) => {
      const previous = await this.logos.find(tx, tenantId);
      await this.logos.set(tx, tenantId, null);
      await this.audit.record(tx, { action: 'tenant.logo_removed', subjectType: 'Setting', subjectId: tenantId, before: { fileId: previous?.id ?? null } });
    });
  }
}
