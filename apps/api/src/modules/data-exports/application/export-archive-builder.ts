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
import { ExportInconsistentError } from '../domain/export-errors.js';
import { exportedFilePath } from '../domain/export-file-name.js';
import { buildManifest, type ExportManifest, type MissingFile, renderReadme } from '../domain/export-manifest.js';
import type { ExportBudget } from './export-budget.js';

/** Rows per page: each page is its own short transaction. */
export const EXPORT_PAGE_SIZE = 1_000;
/** No stored file is larger (4 MB uploads, 20 MB generated PDFs): anything bigger is listed, not read. */
export const EXPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Counting a large table can take longer than an ordinary transaction. */
const COUNT_TIMEOUT_MS = 120_000;
const FILE_INDEX_COLUMNS = ['file_id', 'path', 'original_name', 'mime_type', 'size_bytes', 'sha256', 'origin', 'created_at', 'ticket_id', 'field_code', 'document_role', 'included'] as const;

const utf8 = (text: string) => Buffer.from(text, 'utf8');

/**
 * Writes the archive of one organization: manifest.json and LEEME.txt first (so their counts are taken before the data
 * is written, and checked again after each dataset), then data/*.jsonl and csv/*.csv, then files/index.csv and the
 * files. Every read is a short transaction of the tenant (RLS) with the tenant filtered explicitly; nothing is held
 * open while bytes go to the storage. The tenant is frozen during its deletion period, so a count that changes means
 * something wrote meanwhile: the attempt fails (EXPORT_INCONSISTENT) and is tried again.
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
      const manifest = await this.plan(claim, budget);
      await zip.addBytes('manifest.json', utf8(`${JSON.stringify(manifest, null, 2)}\n`));
      await zip.addBytes('LEEME.txt', utf8(renderReadme(manifest)));
      for (const dataset of EXPORT_DATASETS) {
        const expected = manifest.datasets[dataset.name] ?? 0;
        await this.writeDataset(zip, claim.tenantId, dataset, 'jsonl', expected, budget);
        if (dataset.csv) await this.writeDataset(zip, claim.tenantId, dataset, 'csv', expected, budget);
      }
      if (claim.includeFiles) await this.writeFiles(zip, claim.tenantId, manifest, budget);
      await zip.finish();
      return manifest;
    } catch (error) {
      zip.destroy(error instanceof Error ? error : new Error('The export failed'));
      throw error;
    }
  }

  private async plan(claim: DataExportClaim, budget: ExportBudget): Promise<ExportManifest> {
    const tenant = await this.runner.withTenant(claim.tenantId, (tx) => this.data.organization(tx, claim.tenantId));
    const datasets: Record<string, number> = {};
    for (const dataset of EXPORT_DATASETS) {
      budget.check();
      datasets[dataset.name] = await this.runner.withTenant(claim.tenantId, (tx) => this.data.count(tx, claim.tenantId, dataset.name), { timeoutMs: COUNT_TIMEOUT_MS });
    }
    const { files, missingFiles } = claim.includeFiles ? await this.checkFiles(claim.tenantId, budget) : { files: 0, missingFiles: [] };
    return buildManifest({ exportId: claim.exportId, tenant, generatedAt: this.clock.now(), includeFiles: claim.includeFiles, datasets, files, missingFiles });
  }

  /** Which files are there to copy: a missing or oversized object is listed in the manifest, never fails the export. */
  private async checkFiles(tenantId: string, budget: ExportBudget): Promise<{ files: number; missingFiles: MissingFile[] }> {
    let files = 0;
    const missingFiles: MissingFile[] = [];
    for await (const page of this.filePages(tenantId, budget)) {
      for (const file of page) {
        budget.check();
        const object = await this.storage.head(file.storageKey);
        if (object === null) missingFiles.push({ fileId: file.id, name: file.originalName, reason: 'MISSING' });
        else if (object.sizeBytes > EXPORT_MAX_FILE_BYTES) missingFiles.push({ fileId: file.id, name: file.originalName, reason: 'TOO_LARGE' });
        else files += 1;
      }
    }
    return { files, missingFiles };
  }

  private async writeDataset(zip: ZipArchive, tenantId: string, dataset: ExportDataset<ExportDatasetName>, format: 'jsonl' | 'csv', expected: number, budget: ExportBudget): Promise<void> {
    let written = 0;
    const path = format === 'jsonl' ? `data/${dataset.name}.jsonl` : `csv/${dataset.name}.csv`;
    await zip.addStreamed(path, async (entry) => {
      if (format === 'csv') await entry.write(CSV_BOM + csvRow(dataset.columns));
      for await (const page of this.rowPages(tenantId, dataset, budget)) {
        await entry.write(page.map((row) => (format === 'jsonl' ? jsonLine(row) : csvRecord(row, dataset.columns))).join(''));
        written += page.length;
      }
    });
    if (written !== expected) throw new ExportInconsistentError();
  }

  private async writeFiles(zip: ZipArchive, tenantId: string, manifest: ExportManifest, budget: ExportBudget): Promise<void> {
    const missing = new Set(manifest.missingFiles.map((file) => file.fileId));
    await zip.addStreamed('files/index.csv', async (entry) => {
      await entry.write(CSV_BOM + csvRow(FILE_INDEX_COLUMNS));
      for await (const page of this.filePages(tenantId, budget)) await entry.write(page.map((file) => csvRow(fileIndexRow(file, !missing.has(file.id)))).join(''));
    });
    let copied = 0;
    for await (const page of this.filePages(tenantId, budget)) {
      for (const file of page.filter((row) => !missing.has(row.id))) {
        budget.check();
        await zip.addBytes(exportedFilePath(file.id, file.originalName), await this.storage.read(file.storageKey, EXPORT_MAX_FILE_BYTES));
        copied += 1;
      }
    }
    if (copied !== manifest.files) throw new ExportInconsistentError();
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
