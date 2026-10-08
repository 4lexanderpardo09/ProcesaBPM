import { Inject, Injectable } from '@nestjs/common';
import { InvalidStateError, type MeResponse, NotFoundError, type SetSignatureRequest, type SignatureResponse, UnauthenticatedError, type UpdateProfileRequest } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { ProfileRepository } from '../data/profile.repository.js';

const SIGNATURE_URL_TTL_SECONDS = 300;

/** The signed-in member's own profile and signature. No permission of the catalog applies: it is their own record. */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(ProfileRepository) private readonly profiles: ProfileRepository,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async me(principal: Principal): Promise<MeResponse> {
    const profile = await this.runner.withTenantTransaction((tx) => this.profiles.findProfile(tx, principal.tenantId, principal.userId));
    if (profile === undefined) throw new UnauthenticatedError();
    return { ...profile, tenantMode: principal.tenantMode };
  }

  /** Edits the caller's own name, language and time zone; the audit row goes in the same transaction. */
  update(principal: Principal, request: UpdateProfileRequest): Promise<MeResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.profiles.updateUser(tx, principal.userId, request);
      await this.audit.record(tx, { action: 'account.profile_updated', subjectType: 'User', subjectId: principal.userId, after: request });
      const profile = await this.profiles.findProfile(tx, principal.tenantId, principal.userId);
      if (profile === undefined) throw new UnauthenticatedError();
      return { ...profile, tenantMode: principal.tenantMode };
    });
  }

  /** Links one of the caller's own confirmed images as their signature (the previous one is dropped by the FK). */
  setSignature(principal: Principal, request: SetSignatureRequest): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const file = await this.profiles.findOwnConfirmedFile(tx, principal.tenantId, principal.userId, request.fileId);
      if (file === null) throw new NotFoundError();
      if (!file.mimeType.startsWith('image/')) throw new InvalidStateError('The signature must be a PNG or JPEG image');
      await this.profiles.linkSignature(tx, principal.tenantId, principal.userId, file.id);
    });
  }

  clearSignature(principal: Principal): Promise<void> {
    return this.runner.withTenantTransaction((tx) => this.profiles.linkSignature(tx, principal.tenantId, principal.userId, null));
  }

  /** A short-lived signed URL for the caller's own signature, or null when there is none. */
  async signatureUrl(principal: Principal): Promise<SignatureResponse | null> {
    const file = await this.runner.withTenantTransaction((tx) => this.profiles.findSignature(tx, principal.tenantId, principal.userId));
    if (file === null) return null;
    const signed = await this.storage.presignDownload({
      key: file.storageKey,
      fileName: 'signature',
      contentType: file.mimeType,
      disposition: 'inline',
      expiresInSeconds: SIGNATURE_URL_TTL_SECONDS,
      now: this.clock.now(),
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }
}
