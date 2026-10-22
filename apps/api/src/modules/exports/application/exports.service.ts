import { Inject, Injectable } from '@nestjs/common';
import {
  type DownloadUrlResponse,
  type ExportCatalogResponse,
  type ExportCutoffResponse,
  type ExportDefinitionResponse,
  type ExportLineResponse,
  type ExportPreviewResponse,
  type GenerateExportCutoffResponse,
  InvalidReferenceError,
  NotFoundError,
  type SaveExportCatalogRequest,
  type SaveExportDefinitionRequest,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.js';
import { AuditTrail } from '../../audit/application/audit-trail.js';
import { ExportCatalogsRepository } from '../data/export-catalogs.repository.js';
import { type CutoffRow, ExportCutoffsRepository } from '../data/export-cutoffs.repository.js';
import { type ExportDefinitionRow, ExportDefinitionsRepository } from '../data/export-definitions.repository.js';
import { ExportLinesRepository } from '../data/export-lines.repository.js';
import { ExportSourcesRepository } from '../data/export-sources.repository.js';
import { nextOccurrence } from '../domain/schedule.js';
import { ExportCutoffService } from './export-cutoff.service.js';
import { ExportLineService } from './export-line.service.js';

const DOWNLOAD_TTL_SECONDS = 300;
const LIST_LIMIT = 200;

const toCutoff = (row: CutoffRow): ExportCutoffResponse => ({
  id: row.id,
  definitionId: row.definitionId,
  definitionName: row.definitionName,
  cutoffDate: row.cutoffDate,
  generatedAt: row.generatedAt.toISOString(),
  generatedBy: row.generatedBy,
  isManual: row.isManual,
  lineCount: row.lineCount,
  groupLabel: row.groupLabel,
  responsibleId: row.responsibleId,
  hasFile: row.fileId !== null,
});

/** Scheduled exports ("planos"): their definitions and catalogs, their files, and running a cutoff now. */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(AuditTrail) private readonly audit: AuditTrail,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(ExportDefinitionsRepository) private readonly definitions: ExportDefinitionsRepository,
    @Inject(ExportLinesRepository) private readonly lines: ExportLinesRepository,
    @Inject(ExportCutoffsRepository) private readonly cutoffs: ExportCutoffsRepository,
    @Inject(ExportCatalogsRepository) private readonly catalogs: ExportCatalogsRepository,
    @Inject(ExportSourcesRepository) private readonly sources: ExportSourcesRepository,
    @Inject(ExportLineService) private readonly lineService: ExportLineService,
    @Inject(ExportCutoffService) private readonly cutoffService: ExportCutoffService,
  ) {}

  list(): Promise<ExportDefinitionResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const pending = await this.lines.pendingCounts(tx, this.tenantId);
      const rows = await this.definitions.list(tx, this.tenantId);
      return Promise.all(rows.map((row) => this.toResponse(tx, row, pending.get(row.id) ?? 0)));
    });
  }

  get(id: string): Promise<ExportDefinitionResponse> {
    return this.runner.withTenantTransaction(async (tx) => this.response(tx, id));
  }

  create(request: SaveExportDefinitionRequest): Promise<ExportDefinitionResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.checkReferences(tx, request);
      const id = await this.definitions.create(tx, this.tenantId, request);
      await this.audit.record(tx, { action: 'export.created', subjectType: 'Export', subjectId: id, after: definitionAudit(request) });
      return this.response(tx, id);
    });
  }

  update(id: string, request: SaveExportDefinitionRequest): Promise<ExportDefinitionResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.checkReferences(tx, request);
      await this.definitions.update(tx, this.tenantId, id, request);
      await this.audit.record(tx, { action: 'export.updated', subjectType: 'Export', subjectId: id, before: definitionAudit(before), after: definitionAudit(request) });
      return this.response(tx, id);
    });
  }

  /** Its lines and files go with it; the files stay in storage until the organization is purged. */
  remove(id: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.require(tx, id);
      await this.definitions.remove(tx, this.tenantId, id);
      await this.audit.record(tx, { action: 'export.deleted', subjectType: 'Export', subjectId: id, before: definitionAudit(before) });
    });
  }

  preview(id: string): Promise<ExportPreviewResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const definition = await this.require(tx, id);
      const ticketId = await this.sources.newestTicketId(tx, this.tenantId, definition.workflowId, definition.companyId);
      if (ticketId === undefined) return { ticketNumber: null, row: Object.fromEntries(definition.columns.map((column) => [column.header, ''])) };
      const row = (await this.lineService.preview(tx, this.tenantId, definition, ticketId, this.clock.now())) ?? {};
      const number = (await tx.ticket.findFirst({ where: { tenantId: this.tenantId, id: ticketId }, select: { number: true } }))?.number.toString() ?? null;
      return { ticketNumber: number, row };
    });
  }

  /** "Generate now": the pending lines into files at once, outside the schedule (the schedule is not moved). */
  generateNow(id: string): Promise<GenerateExportCutoffResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      const outcome = await this.cutoffService.generate(tx, this.tenantId, id, { manual: true, actorId: this.userId, at: this.clock.now() });
      const created = await Promise.all(outcome.cutoffIds.map((cutoffId) => this.cutoffs.find(tx, this.tenantId, cutoffId)));
      await this.audit.record(tx, { action: 'export.generated', subjectType: 'Export', subjectId: id, after: { cutoffIds: outcome.cutoffIds, waitingLines: outcome.waitingLines } });
      return { cutoffs: created.flatMap((row) => (row === undefined ? [] : [toCutoff(row)])), waitingLines: outcome.waitingLines };
    });
  }

  cutoffsOf(id: string): Promise<ExportCutoffResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return (await this.cutoffs.ofDefinition(tx, this.tenantId, id, LIST_LIMIT)).map(toCutoff);
    });
  }

  linesOf(id: string, only: { readonly pending?: boolean; readonly cutoffId?: string }): Promise<ExportLineResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.require(tx, id);
      return (await this.lines.list(tx, this.tenantId, id, only, LIST_LIMIT)).map((line) => ({ ...line, createdAt: line.createdAt.toISOString() }));
    });
  }

  /** "Mis planos": the files the caller is responsible for (exports separated by a step's responsible). */
  mine(): Promise<ExportCutoffResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => (await this.cutoffs.ofResponsible(tx, this.tenantId, this.userId, LIST_LIMIT)).map(toCutoff));
  }

  /** A short-lived link to a cutoff's file; with `ownOnly`, only for the file's responsible (anyone else: not found). */
  downloadUrl(cutoffId: string, ownOnly: boolean): Promise<DownloadUrlResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const cutoff = await this.cutoffs.find(tx, this.tenantId, cutoffId);
      if (cutoff === undefined || cutoff.fileId === null || (ownOnly && cutoff.responsibleId !== this.userId)) throw new NotFoundError();
      const file = await this.cutoffs.fileOf(tx, this.tenantId, cutoff.fileId);
      if (file === undefined) throw new NotFoundError();
      const signed = await this.storage.presignDownload({ key: file.storageKey, fileName: file.name, contentType: file.mimeType, disposition: 'attachment', expiresInSeconds: DOWNLOAD_TTL_SECONDS, now: this.clock.now() });
      await this.audit.record(tx, { action: 'export.download_url_issued', subjectType: 'Export', subjectId: cutoff.definitionId, after: { cutoffId, fileId: cutoff.fileId, fileName: file.name, ownFile: ownOnly } });
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    });
  }

  catalogNames(): Promise<string[]> {
    return this.runner.withTenantTransaction((tx) => this.catalogs.names(tx, this.tenantId));
  }

  catalog(name: string): Promise<ExportCatalogResponse> {
    return this.runner.withTenantTransaction(async (tx) => ({ catalog: name, entries: await this.catalogs.entries(tx, this.tenantId, name) }));
  }

  saveCatalog(name: string, request: SaveExportCatalogRequest): Promise<ExportCatalogResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const before = await this.catalogs.entries(tx, this.tenantId, name);
      await this.catalogs.replace(tx, this.tenantId, name, request.entries);
      // The entries are codes of the organization's own systems (accounts, banks): no personal data.
      await this.audit.record(tx, { action: 'export_catalog.updated', subjectType: 'Export', subjectId: null, before: { catalog: name, entries: before }, after: { catalog: name, entries: request.entries } });
      return { catalog: name, entries: await this.catalogs.entries(tx, this.tenantId, name) };
    });
  }

  /** The workflow, the company and the step of the separation must be the organization's (and the step of that workflow). */
  private async checkReferences(tx: TenantTransaction, request: SaveExportDefinitionRequest): Promise<void> {
    if ((await this.sources.workflowName(tx, this.tenantId, request.workflowId)) === undefined) throw new InvalidReferenceError('Unknown workflow');
    if (request.companyId !== null && (await tx.company.count({ where: { tenantId: this.tenantId, id: request.companyId } })) === 0) throw new InvalidReferenceError('Unknown company');
    if (request.separateBy?.kind === 'RESPONSIBLE') {
      const step = await tx.step.count({ where: { tenantId: this.tenantId, id: request.separateBy.stepId, version: { workflowId: request.workflowId } } });
      if (step === 0) throw new InvalidReferenceError('The step is not of this workflow');
    }
  }

  private async require(tx: TenantTransaction, id: string): Promise<ExportDefinitionRow> {
    const definition = await this.definitions.find(tx, this.tenantId, id);
    if (definition === undefined) throw new NotFoundError();
    return definition;
  }

  private async response(tx: TenantTransaction, id: string): Promise<ExportDefinitionResponse> {
    const definition = await this.require(tx, id);
    return this.toResponse(tx, definition, (await this.lines.pendingCounts(tx, this.tenantId)).get(id) ?? 0);
  }

  private async toResponse(tx: TenantTransaction, row: ExportDefinitionRow, pendingLines: number): Promise<ExportDefinitionResponse> {
    const timeZone = await this.sources.defaultTimeZone(tx, this.tenantId, row.companyId);
    const next = row.isActive ? nextOccurrence(row.schedule, this.clock.now(), timeZone, row.lastAutoCutoffAt) : null;
    return {
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      companyId: row.companyId,
      name: row.name,
      format: row.format,
      sheetName: row.sheetName,
      delimiter: row.delimiter,
      trigger: row.trigger,
      transitionLabel: row.transitionLabel,
      filter: row.filter,
      mergeBy: row.mergeBy,
      separateBy: row.separateBy,
      schedule: row.schedule,
      isActive: row.isActive,
      columns: row.columns,
      pendingLines,
      lastAutoCutoffAt: row.lastAutoCutoffAt?.toISOString() ?? null,
      nextCutoffAt: next?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }

  private get userId(): string {
    return this.context.require().userId!;
  }
}

/** What the audit keeps of a definition: its whole configuration, with the columns by header (no ticket data). */
function definitionAudit(definition: SaveExportDefinitionRequest | ExportDefinitionRow) {
  const { workflowId, companyId, name, format, trigger, transitionLabel, filter, mergeBy, separateBy, schedule, isActive, columns } = definition;
  return { workflowId, companyId, name, format, trigger, transitionLabel, filter, mergeBy, separateBy, schedule, isActive, columns: columns.map((column) => column.header) };
}
