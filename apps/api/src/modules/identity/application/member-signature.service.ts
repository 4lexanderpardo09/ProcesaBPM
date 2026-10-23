import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, NotFoundError, PDF_IMAGE_MIME_TYPES, type SetSignatureRequest, type SignatureResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { MemberRepository } from '../data/member.repository.js';

const SIGNATURE_URL_TTL_SECONDS = 300;

/**
 * Another member's signature, kept by whoever manages members: for the people who sign documents but will not upload
 * it themselves. The image is one the administrator uploaded; it becomes the member's as if they had linked it.
 */
@Injectable()
export class MemberSignatureService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(MemberRepository) private readonly repository: MemberRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** A short-lived link to the member's signature, or null when they have none. */
  async url(userId: string): Promise<SignatureResponse | null> {
    const file = await this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, userId);
      return this.repository.signatureFile(tx, this.tenantId, userId);
    });
    if (file === null) return null;
    const signed = await this.storage.presignDownload({ key: file.storageKey, fileName: 'signature', contentType: file.mimeType, disposition: 'inline', expiresInSeconds: SIGNATURE_URL_TTL_SECONDS, now: this.clock.now() });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  set(actingUserId: string, userId: string, request: SetSignatureRequest): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, userId);
      const file = await this.repository.uploadedImage(tx, this.tenantId, actingUserId, request.fileId);
      if (file === null) throw new NotFoundError();
      // Only what the PDFs can draw, as for one's own signature.
      if (!PDF_IMAGE_MIME_TYPES.includes(file.mimeType)) throw new InvalidStateError('The signature must be a PNG or JPEG image');
      await this.repository.linkSignature(tx, this.tenantId, userId, file.id);
      await this.audit.record(tx, { action: 'member.signature_updated', subjectType: 'Membership', subjectId: userId, after: { fileId: file.id } });
    });
  }

  clear(userId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, userId);
      await this.repository.linkSignature(tx, this.tenantId, userId, null);
      await this.audit.record(tx, { action: 'member.signature_removed', subjectType: 'Membership', subjectId: userId });
    });
  }

  private async require(tx: TenantTransaction, userId: string): Promise<void> {
    if ((await this.repository.findById(tx, this.tenantId, userId)) === null) throw new NotFoundError();
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
