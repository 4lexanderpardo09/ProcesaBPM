import { Injectable } from '@nestjs/common';
import type { TicketDocumentRole } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { STORED_FILE_SELECT, type StoredFileRow } from './stored-file.repository.js';

export interface NewTicketDocument {
  readonly fileId: string;
  readonly role: TicketDocumentRole;
  readonly eventId: string;
  readonly stepId: string | null;
  readonly fieldCode: string | null;
}

export interface NewGeneratedDocument {
  readonly fileId: string;
  readonly ticketId: string;
  readonly role: Extract<TicketDocumentRole, 'MAIN_DOCUMENT' | 'STEP_DOCUMENT'>;
  readonly stepId: string | null;
  readonly eventId: string;
  readonly at: Date;
}

export interface TicketDocumentRow {
  readonly id: string;
  readonly role: TicketDocumentRole;
  readonly eventId: string | null;
  readonly stepId: string | null;
  readonly fieldCode: string | null;
  readonly version: number;
  readonly isCurrent: boolean;
  readonly createdAt: Date;
  readonly file: StoredFileRow;
}

@Injectable()
export class TicketDocumentRepository {
  async insertMany(tx: TenantTransaction, tenantId: string, ticketId: string, documents: readonly NewTicketDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await tx.ticketDocument.createMany({ data: documents.map((document) => ({ tenantId, ticketId, ...document })) });
  }

  /** Serializes the version numbering of one ticket's generated documents until the transaction ends. */
  async lockVersions(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${ticketId}:documents`}, 0))`;
  }

  async existsForFile(tx: TenantTransaction, tenantId: string, fileId: string): Promise<boolean> {
    return (await tx.ticketDocument.count({ where: { tenantId, fileId } })) > 0;
  }

  /** Retires the current version of the same document (same role and step) and inserts the next one as current. Needs `lockVersions`. */
  async publishNewVersion(tx: TenantTransaction, tenantId: string, document: NewGeneratedDocument): Promise<void> {
    const same = { tenantId, ticketId: document.ticketId, role: document.role, stepId: document.stepId };
    const latest = await tx.ticketDocument.aggregate({ where: same, _max: { version: true } });
    await tx.ticketDocument.updateMany({ where: { ...same, isCurrent: true }, data: { isCurrent: false } });
    await tx.ticketDocument.create({ data: { ...same, fileId: document.fileId, eventId: document.eventId, fieldCode: null, version: (latest._max.version ?? 0) + 1, isCurrent: true, createdAt: document.at } });
  }

  /** A field's file that was replaced stays in the history (and keeps counting for the quota), but is no longer the current one. */
  async retireFieldFiles(tx: TenantTransaction, tenantId: string, ticketId: string, fieldCode: string, fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await tx.ticketDocument.updateMany({ where: { tenantId, ticketId, fieldCode, fileId: { in: [...fileIds] }, isCurrent: true }, data: { isCurrent: false } });
  }

  list(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketDocumentRow[]> {
    return tx.ticketDocument.findMany({
      where: { tenantId, ticketId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        role: true,
        eventId: true,
        stepId: true,
        fieldCode: true,
        version: true,
        isCurrent: true,
        createdAt: true,
        file: { select: STORED_FILE_SELECT },
      },
    });
  }

  /** The stored file behind a document of this ticket, if the ticket really has it. */
  async findFile(tx: TenantTransaction, tenantId: string, ticketId: string, fileId: string): Promise<StoredFileRow | null> {
    const document = await tx.ticketDocument.findFirst({
      where: { tenantId, ticketId, fileId, deletedAt: null, file: { status: 'CONFIRMED' } },
      select: { file: { select: STORED_FILE_SELECT } },
    });
    return document?.file ?? null;
  }
}
