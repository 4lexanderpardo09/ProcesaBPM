import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** Translation tables of CATALOG columns. Callers pass the tenant's transaction. */
@Injectable()
export class ExportCatalogsRepository {
  async names(tx: TenantTransaction, tenantId: string): Promise<string[]> {
    return (await tx.exportCatalogEntry.findMany({ where: { tenantId }, distinct: ['catalog'], orderBy: { catalog: 'asc' }, select: { catalog: true } })).map((row) => row.catalog);
  }

  async entries(tx: TenantTransaction, tenantId: string, catalog: string): Promise<Array<{ inputValue: string; outputValue: string }>> {
    return tx.exportCatalogEntry.findMany({ where: { tenantId, catalog }, orderBy: { inputValue: 'asc' }, select: { inputValue: true, outputValue: true } });
  }

  /** The tables the given catalogs name, keys in lower case (the lookup ignores case). */
  async load(tx: TenantTransaction, tenantId: string, catalogs: readonly string[]): Promise<Map<string, Map<string, string>>> {
    if (catalogs.length === 0) return new Map();
    const rows = await tx.exportCatalogEntry.findMany({ where: { tenantId, catalog: { in: [...catalogs] } }, select: { catalog: true, inputValue: true, outputValue: true } });
    const tables = new Map<string, Map<string, string>>();
    for (const row of rows) {
      const table = tables.get(row.catalog) ?? new Map<string, string>();
      table.set(row.inputValue.toLowerCase(), row.outputValue);
      tables.set(row.catalog, table);
    }
    return tables;
  }

  async replace(tx: TenantTransaction, tenantId: string, catalog: string, entries: ReadonlyArray<{ inputValue: string; outputValue: string }>): Promise<void> {
    await tx.exportCatalogEntry.deleteMany({ where: { tenantId, catalog } });
    if (entries.length > 0) await tx.exportCatalogEntry.createMany({ data: entries.map((entry) => ({ tenantId, catalog, ...entry })) });
  }
}
