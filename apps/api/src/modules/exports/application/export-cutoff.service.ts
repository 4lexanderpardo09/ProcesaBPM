import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { localDateOf } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { SpreadsheetWriter } from '../../../infrastructure/spreadsheet/spreadsheet-writer.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { SystemFileService } from '../../files/application/system-file.service.js';
import { buildStorageKey } from '../../files/domain/storage-key.js';
import { ExportCutoffsRepository } from '../data/export-cutoffs.repository.js';
import { type ExportDefinitionRow, ExportDefinitionsRepository } from '../data/export-definitions.repository.js';
import { ExportLinesRepository, type PendingLine } from '../data/export-lines.repository.js';
import { ExportSourcesRepository } from '../data/export-sources.repository.js';
import { fillFileColumns, type FileGroup, mergeRows, separateLines, toCsv } from '../domain/file-rows.js';

const MIME = { CSV: 'text/csv', XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;
const WITHOUT_RESPONSIBLE = 'Sin responsable';
const BLANK = '(vacío)';

/** A file name from people's text: letters and digits, the rest as dashes. */
const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export';

export interface CutoffRun {
  readonly manual: boolean;
  readonly actorId: string | null;
  readonly at: Date;
}

export interface CutoffOutcome {
  /** `false` when another cutoff of the same definition was running: nothing was done. */
  readonly ran: boolean;
  readonly cutoffIds: readonly string[];
  /** Lines held back: their ticket is on the responsible's step without a holder yet. */
  readonly waitingLines: number;
}

/**
 * Gathers an export's pending lines into files: one, or one per group when the definition separates them (each
 * responsible of a step, or each value of a column). Rows with the same key merge, then the file numbers its rows and
 * writes the cutoff date. The definition row is locked first, so the scheduled run and "generate now" never take the
 * same lines; the files are stored before the rows that point to them, so a failure leaves at most an orphan object.
 */
@Injectable()
export class ExportCutoffService {
  constructor(
    @Inject(ExportDefinitionsRepository) private readonly definitions: ExportDefinitionsRepository,
    @Inject(ExportLinesRepository) private readonly lines: ExportLinesRepository,
    @Inject(ExportCutoffsRepository) private readonly cutoffs: ExportCutoffsRepository,
    @Inject(ExportSourcesRepository) private readonly sources: ExportSourcesRepository,
    @Inject(SpreadsheetWriter) private readonly spreadsheets: SpreadsheetWriter,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(SystemFileService) private readonly systemFiles: SystemFileService,
  ) {}

  async generate(tx: TenantTransaction, tenantId: string, definitionId: string, run: CutoffRun): Promise<CutoffOutcome> {
    if (!(await this.definitions.lockForCutoff(tx, tenantId, definitionId))) return { ran: false, cutoffIds: [], waitingLines: 0 };
    const definition = (await this.definitions.find(tx, tenantId, definitionId))!;
    const timeZone = await this.sources.defaultTimeZone(tx, tenantId, definition.companyId);
    const cutoffDate = localDateOf(run.at.getTime(), timeZone);
    const pending = await this.lines.pending(tx, tenantId, definitionId);
    const { groups, waiting } = await this.separate(tx, tenantId, definition, pending);

    const cutoffIds: string[] = [];
    for (const group of groups) cutoffIds.push(await this.writeFile(tx, tenantId, definition, group, cutoffDate, run));
    if (!run.manual) await this.definitions.markAutoCutoff(tx, tenantId, definitionId, run.at);
    return { ran: true, cutoffIds, waitingLines: waiting.length };
  }

  private async separate(tx: TenantTransaction, tenantId: string, definition: ExportDefinitionRow, pending: readonly PendingLine[]) {
    const separation = definition.separateBy;
    let holders = new Map<string, { onStep: boolean; userId: string | null }>();
    let names = new Map<string, string>();
    if (separation?.kind === 'RESPONSIBLE') {
      const stepName = await this.sources.stepName(tx, tenantId, separation.stepId);
      holders = stepName === undefined ? new Map() : await this.sources.holdersOn(tx, tenantId, pending.map((line) => line.ticketId), stepName);
      names = await this.sources.names(tx, tenantId, [...new Set([...holders.values()].flatMap((holder) => (holder.userId === null ? [] : [holder.userId])))]);
    }
    return separateLines(pending, separation, {
      holder: (line) => holders.get(line.ticketId) ?? { onStep: false, userId: null },
      nameOf: (userId) => names.get(userId) ?? userId,
      cell: (line, header) => line.data[header] ?? '',
      withoutResponsible: WITHOUT_RESPONSIBLE,
      blank: BLANK,
    });
  }

  private async writeFile(tx: TenantTransaction, tenantId: string, definition: ExportDefinitionRow, group: FileGroup<PendingLine>, cutoffDate: string, run: CutoffRun): Promise<string> {
    const headers = definition.columns.map((column) => column.header);
    const merged = definition.mergeBy === null ? group.lines.map((line) => line.data) : mergeRows(definition.columns, group.lines.map((line) => line.data), definition.mergeBy);
    const rows = fillFileColumns(definition.columns, merged, cutoffDate);
    const bytes =
      definition.format === 'CSV'
        ? toCsv(headers, rows, definition.delimiter)
        : await this.spreadsheets.write([{ name: definition.sheetName, headers, rows: rows.map((row) => headers.map((header) => row[header] ?? '')) }]);

    const fileId = randomUUID();
    const storageKey = buildStorageKey(tenantId, fileId, run.at);
    const extension = definition.format === 'CSV' ? 'csv' : 'xlsx';
    const fileName = `${slug(definition.name)}-${cutoffDate}${group.label === null ? '' : `-${slug(group.label)}`}.${extension}`;
    await this.storage.put({ key: storageKey, body: bytes, contentType: MIME[definition.format] });
    await this.systemFiles.recordSystemFile(tx, tenantId, { fileId, storageKey, fileName, mimeType: MIME[definition.format], sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), companyId: definition.companyId, at: run.at });

    const cutoffId = randomUUID();
    await this.cutoffs.insert(tx, tenantId, {
      id: cutoffId,
      definitionId: definition.id,
      cutoffDate,
      generatedAt: run.at,
      generatedById: run.actorId,
      fileId,
      lineCount: rows.length,
      isManual: run.manual,
      groupKey: group.key,
      groupLabel: group.label,
      responsibleId: group.responsibleId,
    });
    await this.lines.assignCutoff(tx, tenantId, group.lines.map((line) => line.id), cutoffId);
    return cutoffId;
  }
}
