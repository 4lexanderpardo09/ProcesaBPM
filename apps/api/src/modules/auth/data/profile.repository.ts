import { Injectable } from '@nestjs/common';
import type { MeResponse, UpdateProfileRequest } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface SignatureFileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
}

@Injectable()
export class ProfileRepository {
  /** Public columns only: the sensitive ones are omitted by the client and not readable by the role. */
  async findProfile(tx: TenantTransaction, tenantId: string, userId: string): Promise<Omit<MeResponse, 'tenantMode'> | undefined> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        locale: true,
        timeZone: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
      },
    });
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: {
        tenantId: true,
        status: true,
        isOwner: true,
        role: { select: { id: true, name: true, isAdmin: true } },
        companies: { select: { company: { select: { id: true, name: true, isDefault: true } } } },
        signatureFileId: true,
      },
    });
    if (user === null || membership === null || membership.status !== 'ACTIVE') return undefined;
    return {
      user: { ...user, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null },
      membership: {
        tenantId: membership.tenantId,
        status: membership.status,
        isOwner: membership.isOwner,
        role: membership.role,
        companies: membership.companies
          .map(({ company }) => company)
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
        signatureFileId: membership.signatureFileId,
      },
    };
  }

  /** The user's own row: the role can update only the public columns (name, language, time zone). */
  async updateUser(tx: TenantTransaction, userId: string, request: UpdateProfileRequest): Promise<void> {
    const data: { firstName?: string; lastName?: string; locale?: string; timeZone?: string } = {};
    if (request.firstName !== undefined) data.firstName = request.firstName;
    if (request.lastName !== undefined) data.lastName = request.lastName;
    if (request.locale !== undefined) data.locale = request.locale;
    if (request.timeZone !== undefined) data.timeZone = request.timeZone;
    await tx.user.update({ where: { id: userId }, data });
  }

  /** The caller's own confirmed upload, to be linked as a signature: someone else's looks like a missing one. */
  async findOwnConfirmedFile(tx: TenantTransaction, tenantId: string, userId: string, fileId: string): Promise<SignatureFileRow | null> {
    const row = await tx.storedFile.findFirst({
      where: { tenantId, id: fileId, uploadedById: userId, origin: 'USER', status: 'CONFIRMED' },
      select: { id: true, storageKey: true, mimeType: true },
    });
    return row === null ? null : { id: row.id, storageKey: row.storageKey, mimeType: row.mimeType };
  }

  async linkSignature(tx: TenantTransaction, tenantId: string, userId: string, fileId: string | null): Promise<void> {
    await tx.membership.update({ where: { tenantId_userId: { tenantId, userId } }, data: { signatureFileId: fileId } });
  }

  async findSignature(tx: TenantTransaction, tenantId: string, userId: string): Promise<SignatureFileRow | null> {
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { signatureFile: { select: { id: true, storageKey: true, mimeType: true } } },
    });
    const file = membership?.signatureFile ?? null;
    return file === null ? null : { id: file.id, storageKey: file.storageKey, mimeType: file.mimeType };
  }
}
