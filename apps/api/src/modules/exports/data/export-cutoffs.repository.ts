import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface CutoffInsert {
  readonly id: string;
  readonly definitionId: string;
  readonly cutoffDate: string;
  readonly generatedAt: Date;
  readonly generatedById: string | null;
  readonly fileId: string | null;
  readonly lineCount: number;
  readonly isManual: boolean;
  readonly groupKey: string;
  readonly groupLabel: string | null;
  readonly responsibleId: string | null;
}

const select = {
  id: true,
  definitionId: true,
  cutoffDate: true,
  generatedAt: true,
  isManual: true,
  lineCount: true,
  groupLabel: true,
  responsibleId: true,
  fileId: true,
  definition: { select: { name: true } },
  generatedBy: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } },
};

export interface CutoffRow {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly cutoffDate: string;
  readonly generatedAt: Date;
  readonly generatedBy: { readonly id: string; readonly name: string } | null;
  readonly isManual: boolean;
  readonly lineCount: number;
  readonly groupLabel: string | null;
  readonly responsibleId: string | null;
  readonly fileId: string | null;
}

type Selected = {
  id: string;
  definitionId: string;
  cutoffDate: Date;
  generatedAt: Date;
  isManual: boolean;
  lineCount: number;
  groupLabel: string | null;
  responsibleId: string | null;
  fileId: string | null;
  definition: { name: string };
  generatedBy: { userId: string; user: { firstName: string; lastName: string } } | null;
};

const toRow = (row: Selected): CutoffRow => ({
  id: row.id,
  definitionId: row.definitionId,
  definitionName: row.definition.name,
  cutoffDate: row.cutoffDate.toISOString().slice(0, 10),
  generatedAt: row.generatedAt,
  generatedBy: row.generatedBy === null ? null : { id: row.generatedBy.userId, name: `${row.generatedBy.user.firstName} ${row.generatedBy.user.lastName}`.trim() },
  isManual: row.isManual,
  lineCount: row.lineCount,
  groupLabel: row.groupLabel,
  responsibleId: row.responsibleId,
  fileId: row.fileId,
});

/** The files of each export. Callers pass the tenant's transaction. */
@Injectable()
export class ExportCutoffsRepository {
  async insert(tx: TenantTransaction, tenantId: string, cutoff: CutoffInsert): Promise<void> {
    await tx.exportCutoff.create({ data: { tenantId, ...cutoff, cutoffDate: new Date(`${cutoff.cutoffDate}T00:00:00.000Z`) } });
  }

  async ofDefinition(tx: TenantTransaction, tenantId: string, definitionId: string, take: number): Promise<CutoffRow[]> {
    return (await tx.exportCutoff.findMany({ where: { tenantId, definitionId }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }], take, select })).map(toRow);
  }

  /** The files a person is responsible for ("Mis planos"), never anybody else's. */
  async ofResponsible(tx: TenantTransaction, tenantId: string, userId: string, take: number): Promise<CutoffRow[]> {
    return (await tx.exportCutoff.findMany({ where: { tenantId, responsibleId: userId }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }], take, select })).map(toRow);
  }

  async find(tx: TenantTransaction, tenantId: string, cutoffId: string): Promise<CutoffRow | undefined> {
    const row = await tx.exportCutoff.findFirst({ where: { tenantId, id: cutoffId }, select });
    return row === null ? undefined : toRow(row);
  }

  async fileOf(tx: TenantTransaction, tenantId: string, fileId: string): Promise<{ readonly storageKey: string; readonly name: string; readonly mimeType: string } | undefined> {
    const file = await tx.storedFile.findFirst({ where: { tenantId, id: fileId }, select: { storageKey: true, originalName: true, mimeType: true } });
    return file === null ? undefined : { storageKey: file.storageKey, name: file.originalName, mimeType: file.mimeType };
  }
}
