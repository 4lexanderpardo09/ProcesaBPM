import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface PendingLine {
  readonly id: string;
  readonly ticketId: string;
  readonly data: Record<string, string>;
  readonly createdAt: Date;
}

const rowOf = (data: Prisma.JsonValue): Record<string, string> =>
  typeof data === 'object' && data !== null && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? value : ''])) : {};

/** The lines tickets write into exports, and which file each one went into. Callers pass the tenant's transaction. */
@Injectable()
export class ExportLinesRepository {
  /**
   * Writes or rewrites the ticket's line while it is pending. A line already in a file is never touched: `false`.
   * Idempotent by (definition, ticket).
   */
  async upsertPending(tx: TenantTransaction, tenantId: string, definitionId: string, ticketId: string, data: Record<string, string>, actorId: string | null, at: Date): Promise<boolean> {
    const existing = await tx.exportLine.findFirst({ where: { tenantId, definitionId, ticketId }, select: { id: true, cutoffId: true } });
    if (existing?.cutoffId !== undefined && existing.cutoffId !== null) return false;
    if (existing === null) await tx.exportLine.create({ data: { tenantId, definitionId, ticketId, data, confirmedAt: at, confirmedById: actorId } });
    else await tx.exportLine.updateMany({ where: { tenantId, id: existing.id }, data: { data, confirmedAt: at, confirmedById: actorId } });
    return true;
  }

  /** A ticket that no longer passes the filter leaves the export, unless its line is already in a file. */
  async removePending(tx: TenantTransaction, tenantId: string, definitionId: string, ticketId: string): Promise<void> {
    await tx.exportLine.deleteMany({ where: { tenantId, definitionId, ticketId, cutoffId: null } });
  }

  async pending(tx: TenantTransaction, tenantId: string, definitionId: string): Promise<PendingLine[]> {
    const rows = await tx.exportLine.findMany({ where: { tenantId, definitionId, cutoffId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, ticketId: true, data: true, createdAt: true } });
    return rows.map((row) => ({ ...row, data: rowOf(row.data) }));
  }

  async pendingCounts(tx: TenantTransaction, tenantId: string): Promise<Map<string, number>> {
    const rows = await tx.exportLine.groupBy({ by: ['definitionId'], where: { tenantId, cutoffId: null }, _count: { _all: true } });
    return new Map(rows.map((row) => [row.definitionId, row._count._all]));
  }

  async assignCutoff(tx: TenantTransaction, tenantId: string, lineIds: readonly string[], cutoffId: string): Promise<void> {
    await tx.exportLine.updateMany({ where: { tenantId, id: { in: [...lineIds] }, cutoffId: null }, data: { cutoffId } });
  }

  /** The definitions in which a ticket has a line not yet in any file (a step may wait for that file). */
  async pendingFor(tx: TenantTransaction, tenantId: string, ticketId: string, definitionId: string): Promise<boolean> {
    return (await tx.exportLine.count({ where: { tenantId, ticketId, definitionId, cutoffId: null } })) > 0;
  }

  async list(tx: TenantTransaction, tenantId: string, definitionId: string, only: { readonly pending?: boolean; readonly cutoffId?: string }, take: number) {
    const rows = await tx.exportLine.findMany({
      where: { tenantId, definitionId, ...(only.pending === true ? { cutoffId: null } : {}), ...(only.cutoffId === undefined ? {} : { cutoffId: only.cutoffId }) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: { id: true, ticketId: true, data: true, cutoffId: true, createdAt: true, ticket: { select: { number: true } } },
    });
    return rows.map((row) => ({ id: row.id, ticketId: row.ticketId, ticketNumber: row.ticket.number.toString(), data: rowOf(row.data), cutoffId: row.cutoffId, createdAt: row.createdAt }));
  }
}
