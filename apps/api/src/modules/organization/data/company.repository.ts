import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@procesabpm/shared';
import { nameFilter, pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface CompanyRow {
  readonly id: string;
  readonly name: string;
  readonly taxId: string | null;
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly calendarId: string | null;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
}

export interface CompanyWrite {
  readonly name?: string;
  readonly taxId?: string | null;
  readonly countryCode?: string;
  readonly currencyCode?: string;
  readonly timeZone?: string;
  readonly calendarId?: string | null;
}

export interface CountryRow {
  readonly currencyCode: string;
  readonly timeZone: string;
}

const SELECT = {
  id: true,
  name: true,
  taxId: true,
  countryCode: true,
  currencyCode: true,
  timeZone: true,
  calendarId: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
} as const;

/** Every query carries the tenant explicitly on top of row-level security. */
@Injectable()
export class CompanyRepository {
  async list(tx: TenantTransaction, tenantId: string, query: PageQuery): Promise<{ rows: CompanyRow[]; total: number }> {
    const { name: _byName, ...visibility } = nameFilter(query);
    const search = query.search;
    const filter = {
      tenantId,
      ...visibility,
      ...(search === undefined ? {} : { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { taxId: { contains: search, mode: 'insensitive' as const } }] }),
    };
    const [rows, total] = await Promise.all([
      tx.company.findMany({ where: filter, select: SELECT, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], ...pageWindow(query) }),
      tx.company.count({ where: filter }),
    ]);
    return { rows, total };
  }

  findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CompanyRow | null> {
    return tx.company.findFirst({ where: { tenantId, id }, select: SELECT });
  }

  findCountry(tx: TenantTransaction, code: string): Promise<CountryRow | null> {
    return tx.country.findUnique({ where: { code }, select: { currencyCode: true, timeZone: true } });
  }

  async create(tx: TenantTransaction, tenantId: string, data: Required<Pick<CompanyWrite, 'name' | 'countryCode' | 'currencyCode' | 'timeZone'>> & CompanyWrite): Promise<CompanyRow> {
    return tx.company.create({ data: { tenantId, ...data }, select: SELECT });
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: CompanyWrite): Promise<boolean> {
    const { count } = await tx.company.updateMany({ where: { tenantId, id }, data });
    return count > 0;
  }

  /** Deactivating only matches a company that is not the default: the condition is part of the write. */
  async setActive(tx: TenantTransaction, tenantId: string, id: string, isActive: boolean): Promise<boolean> {
    const { count } = await tx.company.updateMany({ where: { tenantId, id, ...(isActive ? {} : { isDefault: false }) }, data: { isActive } });
    return count > 0;
  }

  /** The unique index allows one default, so the previous one is cleared first. */
  async makeDefault(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    await tx.company.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
    const { count } = await tx.company.updateMany({ where: { tenantId, id, isActive: true }, data: { isDefault: true } });
    return count > 0;
  }
}
