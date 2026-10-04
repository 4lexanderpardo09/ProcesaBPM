import { Inject, Injectable } from '@nestjs/common';
import type { ZipArchive } from '../../../infrastructure/archive/zip-archive.js';
import { Clock } from '../../../infrastructure/clock.js';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import type { DataExportClaim } from '../data/data-export-claims.repository.js';
import type { KeyValue } from '../data/dataset-readers/index.js';
import { ExportDataRepository, type ExportFileRow, type ExportRow } from '../data/export-data.repository.js';
import { EXPORT_DATASETS, type ExportDataset, type ExportDatasetName } from '../domain/export-datasets.js';
import { CSV_BOM, csvRecord, csvRow, jsonLine } from '../domain/export-encoding.js';
import { exportedFilePath } from '../domain/export-file-name.js';
import { buildManifest, type ExportManifest, type MissingFile, renderReadme } from '../domain/export-manifest.js';
import type { ExportBudget } from './export-budget.js';

/** Rows per page: each page is its own short transaction. */
export const EXPORT_PAGE_SIZE = 1_000;
/** No stored file is larger (4 MB uploads, 20 MB generated PDFs): anything bigger is listed, not read. */
export const EXPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILE_INDEX_COLUMNS = ['file_id', 'path', 'original_name', 'mime_type', 'size_bytes', 'sha256', 'origin', 'created_at', 'ticket_id', 'field_code', 'document_role', 'included'] as const;

const utf8 = (text: string) => Buffer.from(text, 'utf8');

/**
 * Writes the archive of one organization: LEEME.txt first, then data/*.jsonl and csv/*.csv, the files with
 * files/index.csv, and manifest.json last, with the rows and files actually written. The organization is not frozen
 * (a download link adds an audit row, the nightly retention deletes old ones), so nothing is counted ahead: each
 * dataset is a consistent read page by page and the manifest says what each file holds. Every read is a short
 * transaction of the tenant (RLS) with the tenant filtered explicitly; nothing is held open while bytes go to the
 * storage, and rows are written one at a time (memory: one page of rows, one file, the upload's two parts).
 */
@Injectable()
export class ExportArchiveBuilder {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(ExportDataRepository) private readonly data: ExportDataRepository,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async build(zip: ZipArchive, claim: DataExportClaim, budget: ExportBudget): Promise<ExportManifest> {
    try {
      const generatedAt = this.clock.now();
      const tenant = await this.runner.withTenant(claim.tenantId, (tx) => this.data.organization(tx, claim.tenantId));
      await zip.addBytes('LEEME.txt', utf8(renderReadme({ tenant, generatedAt, includeFiles: claim.includeFiles })));
      const datasets: Record<string, number> = {};
      const csv: Record<string, number> = {};
      for (const dataset of EXPORT_DATASETS) {
        datasets[dataset.name] = await this.writeDataset(zip, claim.tenantId, dataset, 'jsonl', budget);
        if (dataset.csv) csv[dataset.name] = await this.writeDataset(zip, claim.tenantId, dataset, 'csv', budget);
      }
      const { files, missingFiles } = claim.includeFiles ? await this.writeFiles(zip, claim.tenantId, budget) : { files: 0, missingFiles: [] };
      const manifest = buildManifest({ exportId: claim.exportId, tenant, generatedAt, includeFiles: claim.includeFiles, datasets, csv, files, missingFiles });
      await zip.addBytes('manifest.json', utf8(`${JSON.stringify(manifest, null, 2)}\n`));
      await zip.finish();
      return manifest;
    } catch (error) {
      zip.destroy(error instanceof Error ? error : new Error('The export failed'));
      throw error;
    }
  }

  /** Writes one dataset in one format and returns the rows written. */
  private async writeDataset(zip: ZipArchive, tenantId: string, dataset: ExportDataset<ExportDatasetName>, format: 'jsonl' | 'csv', budget: ExportBudget): Promise<number> {
    let written = 0;
    const path = format === 'jsonl' ? `data/${dataset.name}.jsonl` : `csv/${dataset.name}.csv`;
    await zip.addStreamed(path, async (entry) => {
      if (format === 'csv') await entry.write(CSV_BOM + csvRow(dataset.columns));
      for await (const page of this.rowPages(tenantId, dataset, budget)) {
        for (const row of page) await entry.write(format === 'jsonl' ? jsonLine(row) : csvRecord(row, dataset.columns));
        written += page.length;
      }
    });
    return written;
  }

  /**
   * The CONFIRMED files, one at a time; an object that is not in the storage (or is bigger than any accepted file) is
   * listed instead and never fails the export. Then files/index.csv, which says which files are in the archive.
   */
  private async writeFiles(zip: ZipArchive, tenantId: string, budget: ExportBudget): Promise<{ files: number; missingFiles: MissingFile[] }> {
    const copied = new Set<string>();
    const missingFiles: MissingFile[] = [];
    for await (const page of this.filePages(tenantId, budget)) {
      for (const file of page) {
        budget.check();
        const content = await this.readFile(file);
        if (typeof content === 'string') missingFiles.push({ fileId: file.id, name: file.originalName, reason: content });
        else {
          await zip.addBytes(exportedFilePath(file.id, file.originalName), content);
          copied.add(file.id);
        }
      }
    }
    await zip.addStreamed('files/index.csv', async (entry) => {
      await entry.write(CSV_BOM + csvRow(FILE_INDEX_COLUMNS));
      for await (const page of this.filePages(tenantId, budget)) for (const file of page) await entry.write(csvRow(fileIndexRow(file, copied.has(file.id))));
    });
    return { files: copied.size, missingFiles };
  }

  private async readFile(file: ExportFileRow): Promise<Uint8Array | MissingFile['reason']> {
    const object = await this.storage.head(file.storageKey);
    if (object === null) return 'MISSING';
    if (object.sizeBytes > EXPORT_MAX_FILE_BYTES) return 'TOO_LARGE';
    try {
      return await this.storage.read(file.storageKey, EXPORT_MAX_FILE_BYTES);
    } catch (error) {
      // Deleted between the two calls: as missing. Any other failure fails the attempt.
      if ((await this.storage.head(file.storageKey)) === null) return 'MISSING';
      throw error;
    }
  }

  private async *rowPages(tenantId: string, dataset: ExportDataset<ExportDatasetName>, budget: ExportBudget): AsyncGenerator<ExportRow[]> {
    let after: KeyValue[] | null = null;
    for (;;) {
      budget.check();
      const cursor: KeyValue[] | null = after;
      const page: ExportRow[] = await this.runner.withTenant(tenantId, (tx) => this.data.page(tx, tenantId, dataset.name, cursor, EXPORT_PAGE_SIZE));
      if (page.length > 0) yield page;
      if (page.length < EXPORT_PAGE_SIZE) return;
      const last: ExportRow = page.at(-1)!;
      after = dataset.key.map((column): KeyValue => last[column] as KeyValue);
    }
  }

  private async *filePages(tenantId: string, budget: ExportBudget): AsyncGenerator<ExportFileRow[]> {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      budget.check();
      const cursor: string = after;
      const page: ExportFileRow[] = await this.runner.withTenant(tenantId, (tx) => this.data.filePage(tx, tenantId, cursor, EXPORT_PAGE_SIZE));
      if (page.length > 0) yield page;
      if (page.length < EXPORT_PAGE_SIZE) return;
      after = page.at(-1)!.id;
    }
  }
}

function fileIndexRow(file: ExportFileRow, included: boolean): readonly unknown[] {
  return [file.id, included ? exportedFilePath(file.id, file.originalName) : '', file.originalName, file.mimeType, file.sizeBytes, file.sha256, file.origin, file.createdAt, file.ticketId, file.fieldCode, file.documentRole, included];
}
