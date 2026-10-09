import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { DatasetColumn, DatasetListQuery, DatasetRowData } from '@procesabpm/shared';
import { pageWindow } from '../../../common/crud/pagination.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { DatasetSheetRow } from '../domain/dataset-sheet.js';

export interface DatasetRow {
  readonly id: string;
  readonly name: string;
  readonly workflowId: string | null;
  readonly columns: readonly DatasetColumn[];
  readonly sourceFileName: string | null;
  readonly loadedAt: Date;
  readonly isActive: boolean;
  readonly rowCount: number;
}

/** A workflow field that reads the dataset, from its `dataSource`. */
export interface DatasetUse {
  readonly column: string;
  readonly looksUp: boolean;
}

/** Where a form field takes its values from, when that is a dataset the field may use. */
export interface FieldDatasetSource {
  readonly datasetId: string;
  readonly column: string;
}

const SELECT = { id: true, name: true, workflowId: true, columns: true, sourceFileName: true, loadedAt: true, isActive: true, _count: { select: { rows: true } } } as const;

type DatasetRecord = Prisma.DatasetGetPayload<{ select: typeof SELECT }>;

const toRow = (row: DatasetRecord): DatasetRow => ({
  id: row.id,
  name: row.name,
  workflowId: row.workflowId,
  columns: row.columns as unknown as DatasetColumn[],
  sourceFileName: row.sourceFileName,
  loadedAt: row.loadedAt,
  isActive: row.isActive,
  rowCount: row._count.rows,
});

/** Rows go in batches: one statement per 1 000 rows keeps each insert small. */
const INSERT_BATCH = 1_000;

/** `%` and `_` typed by a person are plain characters in the search, not wildcards. */
const likeContains = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Every query names the tenant; RLS is the second wall. */
@Injectable()
export class DatasetRepository {
  async list(tx: TenantTransaction, tenantId: string, query: DatasetListQuery): Promise<{ rows: DatasetRow[]; total: number }> {
    const where: Prisma.DatasetWhereInput = {
      tenantId,
      ...(query.workflowId === undefined ? {} : { workflowId: query.workflowId }),
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search === undefined ? {} : { name: { contains: query.search, mode: 'insensitive' } }),
    };
    const [rows, total] = await Promise.all([tx.dataset.findMany({ where, select: SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...pageWindow(query) }), tx.dataset.count({ where })]);
    return { rows: rows.map(toRow), total };
  }

  async find(tx: TenantTransaction, tenantId: string, id: string): Promise<DatasetRow | null> {
    const row = await tx.dataset.findFirst({ where: { tenantId, id }, select: SELECT });
    return row === null ? null : toRow(row);
  }

  /** Locks the dataset row so two reloads, or a reload and a delete, run one after the other. */
  async lock(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text AS id FROM datasets WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  async workflowExists(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<boolean> {
    return (await tx.workflow.count({ where: { tenantId, id: workflowId } })) > 0;
  }

  async create(tx: TenantTransaction, tenantId: string, data: { name: string; workflowId: string | null; columns: readonly DatasetColumn[]; sourceFileName: string; loadedAt: Date }): Promise<string> {
    const row = await tx.dataset.create({
      data: { tenantId, name: data.name, workflowId: data.workflowId, columns: data.columns as unknown as Prisma.InputJsonValue, sourceFileName: data.sourceFileName, loadedAt: data.loadedAt },
      select: { id: true },
    });
    return row.id;
  }

  async replaceContent(tx: TenantTransaction, tenantId: string, id: string, data: { columns: readonly DatasetColumn[]; sourceFileName: string; loadedAt: Date }): Promise<void> {
    await tx.dataset.updateMany({ where: { tenantId, id }, data: { columns: data.columns as unknown as Prisma.InputJsonValue, sourceFileName: data.sourceFileName, loadedAt: data.loadedAt } });
    await tx.datasetRow.deleteMany({ where: { tenantId, datasetId: id } });
  }

  async insertRows(tx: TenantTransaction, tenantId: string, datasetId: string, rows: readonly DatasetSheetRow[]): Promise<void> {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      await tx.datasetRow.createMany({ data: rows.slice(start, start + INSERT_BATCH).map((row) => ({ tenantId, datasetId, lookupKey: row.lookupKey, data: row.data })) });
    }
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, data: { name?: string; isActive?: boolean }): Promise<void> {
    await tx.dataset.updateMany({ where: { tenantId, id }, data });
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.datasetRow.deleteMany({ where: { tenantId, datasetId: id } });
    await tx.dataset.deleteMany({ where: { tenantId, id } });
  }

  async rows(tx: TenantTransaction, tenantId: string, datasetId: string, window: { skip: number; take: number }): Promise<DatasetRowData[]> {
    const rows = await tx.datasetRow.findMany({ where: { tenantId, datasetId }, select: { data: true }, orderBy: { id: 'asc' }, ...window });
    return rows.map((row) => row.data as DatasetRowData);
  }

  /** The fields of any version (draft, published or archived: a ticket on an archived version still fills them). */
  async uses(tx: TenantTransaction, tenantId: string, datasetId: string): Promise<DatasetUse[]> {
    const fields = await tx.field.findMany({ where: { tenantId, dataSource: { path: ['datasetId'], equals: datasetId } }, select: { dataSource: true } });
    return fields.map((field) => {
      const source = record(field.dataSource);
      return { column: String(source.column ?? ''), looksUp: typeof source.lookupFieldCode === 'string' };
    });
  }

  /**
   * The dataset a field of a non-draft version reads, if the field has one that is active and that its workflow may use.
   * Drafts are left out: a person only fills forms of published (or, for tickets already running, archived) versions.
   */
  async sourceOfField(tx: TenantTransaction, tenantId: string, fieldId: string): Promise<FieldDatasetSource | null> {
    const field = await tx.field.findFirst({
      where: { tenantId, id: fieldId, version: { status: { not: 'DRAFT' } } },
      select: { dataSource: true, version: { select: { workflowId: true } } },
    });
    const source = record(field?.dataSource);
    if (field === null || source.kind !== 'DATASET' || typeof source.datasetId !== 'string' || typeof source.column !== 'string') return null;
    const usable = await tx.dataset.count({ where: { tenantId, id: source.datasetId, isActive: true, OR: [{ workflowId: null }, { workflowId: field.version.workflowId }] } });
    return usable === 0 ? null : { datasetId: source.datasetId, column: source.column };
  }

  /** Distinct values of one column that contain the text (ignoring case, not accents), alphabetically. */
  async options(tx: TenantTransaction, tenantId: string, datasetId: string, column: string, text: string, limit: number): Promise<string[]> {
    const rows = await tx.$queryRaw<Array<{ value: string }>>`
      SELECT DISTINCT data->>${column} AS value
      FROM dataset_rows
      WHERE tenant_id = ${tenantId}::uuid AND dataset_id = ${datasetId}::uuid AND data->>${column} IS NOT NULL
        AND (${text} = '' OR data->>${column} ILIKE ${likeContains(text)})
      ORDER BY 1
      LIMIT ${limit}`;
    return rows.map((row) => row.value);
  }

  /** The column's value in the row with that key (the index on `lookup_key` answers it). */
  async lookup(tx: TenantTransaction, tenantId: string, datasetId: string, key: string, column: string): Promise<string | null> {
    const row = await tx.datasetRow.findFirst({ where: { tenantId, datasetId, lookupKey: key }, select: { data: true } });
    const value = record(row?.data)[column];
    return typeof value === 'string' ? value : null;
  }
}
