import { Injectable } from '@nestjs/common';
import type { ExportColumn, ExportFilterRule, ExportSchedule, ExportSeparation, SaveExportDefinitionRequest } from '@procesabpm/shared';
import { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** A definition as the services work with it: the schedule and the JSON columns already typed. */
export interface ExportDefinitionRow {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly companyId: string | null;
  readonly name: string;
  readonly format: 'CSV' | 'XLSX';
  readonly sheetName: string;
  readonly delimiter: string;
  readonly trigger: 'TRANSITION' | 'CLOSING';
  readonly transitionLabel: string | null;
  readonly filter: ExportFilterRule[];
  readonly mergeBy: string | null;
  readonly separateBy: ExportSeparation | null;
  readonly schedule: ExportSchedule;
  readonly isActive: boolean;
  readonly lastAutoCutoffAt: Date | null;
  readonly createdAt: Date;
  readonly columns: ExportColumn[];
}

const select = {
  id: true,
  workflowId: true,
  companyId: true,
  name: true,
  format: true,
  sheetName: true,
  delimiter: true,
  trigger: true,
  transitionLabel: true,
  filter: true,
  groupBy: true,
  separateBy: true,
  cutoffTime: true,
  frequency: true,
  weekdays: true,
  monthDay: true,
  intervalDays: true,
  isActive: true,
  lastAutoCutoffAt: true,
  createdAt: true,
  workflow: { select: { name: true } },
  columns: { orderBy: { sortOrder: 'asc' as const }, select: { header: true, sourceType: true, sourceRef: true, format: true } },
};

type SelectedDefinition = Awaited<ReturnType<TenantTransaction['exportDefinition']['findFirstOrThrow']>> & {
  workflow: { name: string };
  columns: ExportColumn[];
};

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const hhmm = (time: Date) => time.toISOString().slice(11, 16);
const timeOf = (hhmmText: string) => new Date(`1970-01-01T${hhmmText}:00.000Z`);

function toRow(definition: SelectedDefinition): ExportDefinitionRow {
  return {
    id: definition.id,
    workflowId: definition.workflowId,
    workflowName: definition.workflow.name,
    companyId: definition.companyId,
    name: definition.name,
    format: definition.format,
    sheetName: definition.sheetName,
    delimiter: definition.delimiter,
    trigger: definition.trigger,
    transitionLabel: definition.transitionLabel,
    filter: Array.isArray(definition.filter) ? (definition.filter as unknown as ExportFilterRule[]) : [],
    mergeBy: definition.groupBy,
    separateBy: (definition.separateBy as unknown as ExportSeparation | null) ?? null,
    schedule: { cutoffTime: hhmm(definition.cutoffTime), frequency: definition.frequency, weekdays: definition.weekdays, monthDay: definition.monthDay, intervalDays: definition.intervalDays },
    isActive: definition.isActive,
    lastAutoCutoffAt: definition.lastAutoCutoffAt,
    createdAt: definition.createdAt,
    columns: definition.columns,
  };
}

function dataOf(request: SaveExportDefinitionRequest) {
  return {
    workflowId: request.workflowId,
    companyId: request.companyId,
    name: request.name,
    format: request.format,
    sheetName: request.sheetName,
    delimiter: request.delimiter,
    trigger: request.trigger,
    transitionLabel: request.trigger === 'TRANSITION' ? request.transitionLabel : null,
    filter: request.filter.length === 0 ? Prisma.DbNull : json(request.filter),
    groupBy: request.mergeBy,
    separateBy: request.separateBy === null ? Prisma.DbNull : json(request.separateBy),
    cutoffTime: timeOf(request.schedule.cutoffTime),
    frequency: request.schedule.frequency,
    weekdays: request.schedule.frequency === 'WEEKLY' ? [...new Set(request.schedule.weekdays)].sort() : [],
    monthDay: request.schedule.frequency === 'MONTHLY' ? request.schedule.monthDay : null,
    intervalDays: request.schedule.frequency === 'EVERY_N_DAYS' ? request.schedule.intervalDays : null,
    isActive: request.isActive,
  };
}

/** Export definitions and their columns. Callers pass the tenant's transaction. */
@Injectable()
export class ExportDefinitionsRepository {
  async list(tx: TenantTransaction, tenantId: string): Promise<ExportDefinitionRow[]> {
    const rows = await tx.exportDefinition.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, select });
    return rows.map((row) => toRow(row as SelectedDefinition));
  }

  async find(tx: TenantTransaction, tenantId: string, id: string): Promise<ExportDefinitionRow | undefined> {
    const row = await tx.exportDefinition.findFirst({ where: { tenantId, id }, select });
    return row === null ? undefined : toRow(row as SelectedDefinition);
  }

  /** Locks the definition for a cutoff: two cutoffs of the same definition never gather the same lines. `undefined` when another one holds it. */
  async lockForCutoff(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id::text FROM export_definitions WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
    return rows.length > 0;
  }

  /** The active definitions a ticket event may write a line for. */
  async activeForWorkflow(tx: TenantTransaction, tenantId: string, workflowId: string, trigger: 'TRANSITION' | 'CLOSING'): Promise<ExportDefinitionRow[]> {
    const rows = await tx.exportDefinition.findMany({ where: { tenantId, workflowId, trigger, isActive: true }, select });
    return rows.map((row) => toRow(row as SelectedDefinition));
  }

  async activeIds(tx: TenantTransaction, tenantId: string): Promise<string[]> {
    return (await tx.exportDefinition.findMany({ where: { tenantId, isActive: true }, select: { id: true }, orderBy: { id: 'asc' } })).map((row) => row.id);
  }

  async create(tx: TenantTransaction, tenantId: string, request: SaveExportDefinitionRequest): Promise<string> {
    const created = await tx.exportDefinition.create({ data: { tenantId, ...dataOf(request) }, select: { id: true } });
    await this.replaceColumns(tx, tenantId, created.id, request.columns);
    return created.id;
  }

  async update(tx: TenantTransaction, tenantId: string, id: string, request: SaveExportDefinitionRequest): Promise<void> {
    await tx.exportDefinition.updateMany({ where: { tenantId, id }, data: dataOf(request) });
    await this.replaceColumns(tx, tenantId, id, request.columns);
  }

  async remove(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx.exportDefinition.deleteMany({ where: { tenantId, id } });
  }

  async markAutoCutoff(tx: TenantTransaction, tenantId: string, id: string, at: Date): Promise<void> {
    await tx.exportDefinition.updateMany({ where: { tenantId, id }, data: { lastAutoCutoffAt: at } });
  }

  private async replaceColumns(tx: TenantTransaction, tenantId: string, definitionId: string, columns: readonly ExportColumn[]): Promise<void> {
    await tx.exportColumn.deleteMany({ where: { tenantId, definitionId } });
    await tx.exportColumn.createMany({ data: columns.map((column, sortOrder) => ({ tenantId, definitionId, sortOrder, header: column.header, sourceType: column.sourceType, sourceRef: column.sourceRef, format: column.format })) });
  }
}
