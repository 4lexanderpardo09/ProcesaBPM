import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface ErrorTypeRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isProcessError: boolean;
  readonly forcesClose: boolean;
  readonly isReopening: boolean;
  readonly isActive: boolean;
}

export interface ErrorTypeWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly isProcessError?: boolean;
  readonly forcesClose?: boolean;
  readonly isReopening?: boolean;
  readonly isActive?: boolean;
}

export interface ErrorSubtypeRow {
  readonly id: string;
  readonly errorTypeId: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
}

export interface ErrorSubtypeWrite {
  readonly name?: string;
  readonly description?: string | null;
  readonly isActive?: boolean;
}

const TYPE_SELECT = { id: true, name: true, description: true, isProcessError: true, forcesClose: true, isReopening: true, isActive: true } as const;
const SUBTYPE_SELECT = { id: true, errorTypeId: true, name: true, description: true, isActive: true } as const;

@Injectable()
export class ErrorTypeRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: ErrorTypeRow[]; total: number }> {
    const where = { tenantId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([tx.errorType.findMany({ where, select: TYPE_SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageWindow(query) }), tx.errorType.count({ where })]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<ErrorTypeRow | null> {
    return tx.errorType.findFirst({ where: { tenantId, id }, select: TYPE_SELECT });
  }

  create(tx: TenantTransaction, tenantId: string, data: { name: string; description?: string; isProcessError?: boolean; forcesClose?: boolean; isReopening?: boolean }): Promise<ErrorTypeRow> {
    return tx.errorType.create({ data: { tenantId, ...data }, select: TYPE_SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: ErrorTypeWrite): Promise<void> {
    await tx.errorType.updateMany({ where: { tenantId, id }, data });
  }

  /** Locks (in id order) the active reopening types, so that two deactivations at once cannot both leave the tenant without one. */
  async lockActiveReopening(tx: TenantTransaction, tenantId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM error_types WHERE tenant_id = ${tenantId}::uuid AND is_reopening AND is_active ORDER BY id FOR UPDATE`;
    return rows.map((row) => row.id);
  }

  async listSubtypes(tx: TenantTransaction, tenantId: string, errorTypeId: string, query: PageQuery): Promise<{ rows: ErrorSubtypeRow[]; total: number }> {
    const where = { tenantId, errorTypeId, ...nameFilter(query) };
    const [rows, total] = await Promise.all([tx.errorSubtype.findMany({ where, select: SUBTYPE_SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageWindow(query) }), tx.errorSubtype.count({ where })]);
    return { rows, total };
  }

  findSubtype(tx: TenantTransaction, tenantId: string, errorTypeId: string, id: string): Promise<ErrorSubtypeRow | null> {
    return tx.errorSubtype.findFirst({ where: { tenantId, errorTypeId, id }, select: SUBTYPE_SELECT });
  }

  createSubtype(tx: TenantTransaction, tenantId: string, errorTypeId: string, data: { name: string; description?: string }): Promise<ErrorSubtypeRow> {
    return tx.errorSubtype.create({ data: { tenantId, errorTypeId, ...data }, select: SUBTYPE_SELECT });
  }

  async updateSubtype(tx: TenantTransaction, tenantId: string, errorTypeId: string, id: string, data: ErrorSubtypeWrite): Promise<void> {
    await tx.errorSubtype.updateMany({ where: { tenantId, errorTypeId, id }, data });
  }
}
