import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface LogoFileRow {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
}

@Injectable()
export class TenantLogoRepository {
  async find(tx: TenantTransaction, tenantId: string): Promise<LogoFileRow | null> {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { logoFileId: true } });
    if (tenant?.logoFileId == null) return null;
    return tx.storedFile.findFirst({ where: { tenantId, id: tenant.logoFileId, status: 'CONFIRMED' }, select: { id: true, storageKey: true, mimeType: true } });
  }

  async set(tx: TenantTransaction, tenantId: string, fileId: string | null): Promise<void> {
    await tx.tenant.update({ where: { id: tenantId }, data: { logoFileId: fileId } });
  }
}
