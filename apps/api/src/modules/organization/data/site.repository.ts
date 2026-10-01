import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface SiteRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly level: number;
  readonly name: string;
  readonly isCentral: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

const SELECT = { id: true, parentId: true, level: true, name: true, isCentral: true, isActive: true, createdAt: true } as const;

@Injectable()
export class SiteRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: SiteRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([
      tx.site.findMany({ where, select: SELECT, orderBy: [{ level: 'asc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.site.count({ where }),
    ]);
    return { rows, total };
  }

  /** Every site of the tenant (configuration data: small), for the tree and for the cycle check. */
  findAll(tx: TenantTransaction, tenantId: string, options: { includeInactive: boolean }): Promise<SiteRow[]> {
    return tx.site.findMany({
      where: { tenantId, ...(options.includeInactive ? {} : { isActive: true }) },
      select: SELECT,
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<SiteRow | null> {
    return tx.site.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { name: string; parentId?: string; level: number; isCentral?: boolean }): Promise<SiteRow> {
    return tx.site.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isCentral?: boolean; isActive?: boolean }): Promise<void> {
    await tx.site.updateMany({ where: { tenantId, id }, data });
  }

  async setParentAndLevel(tx: TenantTransaction, tenantId: string, id: string, parentId: string | null | undefined, level: number): Promise<void> {
    await tx.site.updateMany({ where: { tenantId, id }, data: { level, ...(parentId === undefined ? {} : { parentId }) } });
  }

  async countAtLevel(tx: TenantTransaction, tenantId: string, level: number): Promise<number> {
    return tx.site.count({ where: { tenantId, level } });
  }
}
