import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface VisibilityRows {
  readonly companyIds: string[];
  readonly departmentIds: string[];
}

export interface VisibleCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly subcategories: ReadonlyArray<{ id: string; name: string; description: string | null; defaultPriorityId: string | null }>;
}

const SELECT = { id: true, name: true, isActive: true, createdAt: true } as const;

@Injectable()
export class CategoryRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: CategoryRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([
      tx.category.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, ...pageWindow(query) }),
      tx.category.count({ where }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CategoryRow | null> {
    return tx.category.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, name: string): Promise<CategoryRow> {
    return tx.category.create({ data: { tenantId, name }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.category.updateMany({ where: { tenantId, id }, data });
  }

  async findVisibility(tx: TenantTransaction, tenantId: string, categoryId: string): Promise<VisibilityRows> {
    const [companies, departments] = await Promise.all([
      tx.categoryCompany.findMany({ where: { tenantId, categoryId }, select: { companyId: true } }),
      tx.categoryDepartment.findMany({ where: { tenantId, categoryId }, select: { departmentId: true } }),
    ]);
    return { companyIds: companies.map((row) => row.companyId), departmentIds: departments.map((row) => row.departmentId) };
  }

  async replaceVisibility(tx: TenantTransaction, tenantId: string, categoryId: string, visibility: VisibilityRows): Promise<void> {
    await tx.categoryCompany.deleteMany({ where: { tenantId, categoryId } });
    await tx.categoryDepartment.deleteMany({ where: { tenantId, categoryId } });
    await tx.categoryCompany.createMany({ data: visibility.companyIds.map((companyId) => ({ tenantId, categoryId, companyId })) });
    await tx.categoryDepartment.createMany({ data: visibility.departmentIds.map((departmentId) => ({ tenantId, categoryId, departmentId })) });
  }

  /**
   * Active categories (with their active subcategories) that a user of `companyIds` and `departmentId`
   * may pick. A category with no visibility rows on an axis is visible to everyone on that axis; a user
   * without department only sees the categories that are not restricted by department.
   */
  findVisible(tx: TenantTransaction, tenantId: string, who: { companyIds: readonly string[]; departmentId: string | null }): Promise<VisibleCategoryRow[]> {
    return tx.category.findMany({
      where: {
        tenantId,
        isActive: true,
        AND: [
          { OR: [{ companies: { none: {} } }, { companies: { some: { companyId: { in: [...who.companyIds] } } } }] },
          { OR: [{ departments: { none: {} } }, ...(who.departmentId === null ? [] : [{ departments: { some: { departmentId: who.departmentId } } }])] },
        ],
      },
      select: {
        id: true,
        name: true,
        subcategories: {
          where: { isActive: true },
          select: { id: true, name: true, description: true, defaultPriorityId: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
}
