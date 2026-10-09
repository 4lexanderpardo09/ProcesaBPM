import { Inject, Injectable } from '@nestjs/common';
import {
  ALLOWED_FILE_TYPES,
  type CreateDatasetRequest,
  DatasetFileInvalidError,
  DatasetInUseError,
  type DatasetListQuery,
  type DatasetResponse,
  type DatasetRowData,
  type DatasetRowsQuery,
  MAX_FILE_BYTES,
  NotFoundError,
  type Page,
  type ReloadDatasetRequest,
  type UpdateDatasetRequest,
} from '@procesabpm/shared';
import { pageWindow, toPage } from '../../../common/crud/pagination.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SpreadsheetReadError, SpreadsheetReader } from '../../../infrastructure/spreadsheet/spreadsheet-reader.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { FileAttachmentService } from '../../files/application/file-attachment.service.js';
import { buildDatasetSheet, type DatasetSheet } from '../domain/dataset-sheet.js';
import { type DatasetRow, DatasetRepository } from '../data/dataset.repository.js';

const XLSX_MIME = ALLOWED_FILE_TYPES.xlsx!.mime;
/** What a workbook may take once unzipped: a 4 MB `.xlsx` of plain data is far below it, a zip bomb is not. */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;

const toResponse = (row: DatasetRow): DatasetResponse => ({
  id: row.id,
  name: row.name,
  workflowId: row.workflowId,
  columns: row.columns,
  keyColumn: row.columns.find((column) => column.isKey)?.name ?? null,
  rowCount: row.rowCount,
  sourceFileName: row.sourceFileName,
  loadedAt: row.loadedAt.toISOString(),
  isActive: row.isActive,
});

/**
 * Datasets: spreadsheets loaded as the source of field values. The workbook is read and checked with no transaction open
 * (a network call and real work); only then is everything written at once, so a refused file leaves nothing behind. The
 * upload itself is not linked: once read it is not needed, and the purge of abandoned uploads removes it.
 */
@Injectable()
export class DatasetsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DatasetRepository) private readonly datasets: DatasetRepository,
    @Inject(FileAttachmentService) private readonly files: FileAttachmentService,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(SpreadsheetReader) private readonly reader: SpreadsheetReader,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  list(query: DatasetListQuery): Promise<Page<DatasetResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.datasets.list(tx, this.tenantId, query);
      return toPage(rows, total, query, toResponse);
    });
  }

  get(id: string): Promise<DatasetResponse> {
    return this.runner.withTenantTransaction(async (tx) => toResponse(await this.require(tx, id)));
  }

  rows(id: string, query: DatasetRowsQuery): Promise<Page<DatasetRowData>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const dataset = await this.require(tx, id);
      const rows = await this.datasets.rows(tx, this.tenantId, id, pageWindow(query));
      return { items: rows, page: query.page, pageSize: query.pageSize, total: dataset.rowCount };
    });
  }

  async create(request: CreateDatasetRequest): Promise<DatasetResponse> {
    const file = await this.runner.withTenantTransaction(async (tx) => {
      if (request.workflowId !== undefined && !(await this.datasets.workflowExists(tx, this.tenantId, request.workflowId))) throw new NotFoundError();
      return this.ownWorkbook(tx, request.fileId);
    });
    const sheet = await this.readSheet(file.storageKey, request.keyColumn);
    return this.runner.withTenantTransaction(async (tx) => {
      const id = await this.datasets.create(tx, this.tenantId, { name: request.name, workflowId: request.workflowId ?? null, columns: sheet.columns, sourceFileName: file.originalName, loadedAt: this.clock.now() });
      await this.datasets.insertRows(tx, this.tenantId, id, sheet.rows);
      await this.audit.record(tx, { action: 'dataset.created', subjectType: 'Dataset', subjectId: id, after: { name: request.name, workflowId: request.workflowId ?? null, ...summary(sheet, file.originalName) } });
      return toResponse(await this.require(tx, id));
    });
  }

  /**
   * Replaces every row. Without `keyColumn` the current key is kept. The fields that use the dataset must still find what
   * they read: every column they name, and a key when one of them looks rows up by it.
   */
  async reload(id: string, request: ReloadDatasetRequest): Promise<DatasetResponse> {
    const { file, currentKey } = await this.runner.withTenantTransaction(async (tx) => {
      const dataset = await this.require(tx, id);
      return { file: await this.ownWorkbook(tx, request.fileId), currentKey: dataset.columns.find((column) => column.isKey)?.name };
    });
    const sheet = await this.readSheet(file.storageKey, request.keyColumn ?? currentKey);
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.datasets.lock(tx, this.tenantId, id))) throw new NotFoundError();
      const before = await this.require(tx, id);
      const uses = await this.datasets.uses(tx, this.tenantId, id);
      const available = new Set(sheet.columns.map((column) => column.name));
      const missing = [...new Set(uses.map((use) => use.column).filter((column) => !available.has(column)))];
      if (sheet.keyColumn === null && uses.some((use) => use.looksUp)) missing.push(currentKey ?? '(key column)');
      if (missing.length > 0) throw new DatasetInUseError(missing);
      await this.datasets.replaceContent(tx, this.tenantId, id, { columns: sheet.columns, sourceFileName: file.originalName, loadedAt: this.clock.now() });
      await this.datasets.insertRows(tx, this.tenantId, id, sheet.rows);
      await this.audit.record(tx, {
        action: 'dataset.reloaded',
        subjectType: 'Dataset',
        subjectId: id,
        before: { rowCount: before.rowCount, columns: before.columns.map((column) => column.name), sourceFileName: before.sourceFileName },
        after: summary(sheet, file.originalName),
      });
      return toResponse(await this.require(tx, id));
    });
  }

  update(id: string, request: UpdateDatasetRequest): Promise<DatasetResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      const data: { name?: string; isActive?: boolean } = {};
      if (request.name !== undefined) data.name = request.name;
      if (request.isActive !== undefined) data.isActive = request.isActive;
      await this.datasets.update(tx, this.tenantId, id, data);
      await this.audit.record(tx, { action: 'dataset.updated', subjectType: 'Dataset', subjectId: id, before: { name: before.name, isActive: before.isActive }, after: data });
      return toResponse(await this.require(tx, id));
    });
  }

  /** Only a dataset no field uses: otherwise a ticket could no longer validate or fill it (deactivate it instead). */
  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      if (!(await this.datasets.lock(tx, this.tenantId, id))) throw new NotFoundError();
      const before = await this.require(tx, id);
      if ((await this.datasets.uses(tx, this.tenantId, id)).length > 0) throw new DatasetInUseError();
      await this.datasets.remove(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'dataset.deleted', subjectType: 'Dataset', subjectId: id, before: { name: before.name, workflowId: before.workflowId, rowCount: before.rowCount } });
    });
  }

  /** The caller's own confirmed, unattached `.xlsx` upload (the type was checked against the content when confirmed). */
  private async ownWorkbook(tx: TenantTransaction, fileId: string): Promise<{ storageKey: string; originalName: string }> {
    const file = await this.files.peekOwn(tx, this.tenantId, this.context.require().userId, fileId);
    if (file === null) throw new NotFoundError();
    if (file.mimeType !== XLSX_MIME) throw new DatasetFileInvalidError('NOT_XLSX');
    return { storageKey: file.storageKey, originalName: file.originalName };
  }

  private async readSheet(storageKey: string, keyColumn: string | undefined): Promise<DatasetSheet> {
    const content = await this.storage.read(storageKey, MAX_FILE_BYTES);
    try {
      return buildDatasetSheet(await this.reader.readFirstSheet(content, { maxUnzippedBytes: MAX_UNZIPPED_BYTES }), keyColumn);
    } catch (error) {
      if (error instanceof SpreadsheetReadError) throw new DatasetFileInvalidError(error.reason);
      throw error;
    }
  }

  private async require(tx: TenantTransaction, id: string): Promise<DatasetRow> {
    const row = await this.datasets.find(tx, this.tenantId, id);
    if (row === null) throw new NotFoundError();
    return row;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}

/** What the audit keeps of a load: never the rows themselves. */
const summary = (sheet: DatasetSheet, sourceFileName: string) => ({ rowCount: sheet.rows.length, columns: sheet.columns.map((column) => column.name), keyColumn: sheet.keyColumn, sourceFileName });
