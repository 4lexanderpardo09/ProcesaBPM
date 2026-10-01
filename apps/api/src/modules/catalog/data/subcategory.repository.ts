import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface SubcategoryRow {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly defaultPriorityId: string | null;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface SubcategoryWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly defaultPriorityId?: string | null;
  readonly isActive?: boolean;
}

const SELECT = { id: true, categoryId: true, name: true, description: true, defaultPriorityId: true, isActive: true, createdAt: true } as const;

@Injectable()
export class SubcategoryRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery, categoryId?: string): Promise<{ rows: SubcategoryRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query), ...(categoryId === undefined ? {} : { categoryId }) };
    const [rows, total] = await Promise.all([
      tx.subcategory.findMany({ where, select: SELECT, orderBy: [{ categoryId: 'asc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.subcategory.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<SubcategoryRow | null> {
    return tx.subcategory.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { categoryId: string; name: string; description?: string; defaultPriorityId?: string }): Promise<SubcategoryRow> {
    return tx.subcategory.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: SubcategoryWrite): Promise<void> {
    await tx.subcategory.updateMany({ where: { tenantId, id }, data });
  }
}
