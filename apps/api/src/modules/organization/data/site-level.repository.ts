import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface SiteLevelRow {
  readonly level: number;
  readonly name: string;
}

@Injectable()
export class SiteLevelRepository {
  list(tx: TenantTransaction, tenantId: string): Promise<SiteLevelRow[]> {
    return tx.siteLevel.findMany({ where: { tenantId }, select: { level: true, name: true }, orderBy: { level: 'asc' } });
  }

  async upsert(tx: TenantTransaction, tenantId: string, level: number, name: string): Promise<void> {
    await tx.siteLevel.upsert({
      where: { tenantId_level: { tenantId, level } },
      create: { tenantId, level, name },
      update: { name },
    });
  }

  async remove(tx: TenantTransaction, tenantId: string, level: number): Promise<void> {
    await tx.siteLevel.deleteMany({ where: { tenantId, level } });
  }
}
