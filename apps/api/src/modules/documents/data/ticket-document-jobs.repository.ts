import { Injectable } from '@nestjs/common';
import type { DocumentMoment, OutboxStatus } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { DOCUMENT_GENERATE_EVENT } from '../application/document-generate.payload.js';

export interface JobTicket {
  readonly workflowId: string;
  readonly companyId: string;
  /** The ticket's latest event: a document drawn again points at it. */
  readonly lastEventId: string | null;
}

export interface WorkflowDocumentChoice {
  readonly id: string;
  readonly name: string;
  readonly companyId: string | null;
  readonly moment: DocumentMoment | null;
  /** The document and what it draws from are switched on. */
  readonly usable: boolean;
}

export interface LastJob {
  readonly workflowDocumentId: string;
  readonly status: OutboxStatus;
  readonly createdAt: Date;
  readonly payload: unknown;
}

/** The drawing requests of a ticket's documents (outbox events) and the documents its workflow can draw. */
@Injectable()
export class TicketDocumentJobsRepository {
  async ticket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<JobTicket | null> {
    const row = await tx.ticket.findFirst({
      where: { tenantId, id: ticketId, deletedAt: null },
      select: { workflowId: true, companyId: true, events: { orderBy: { seq: 'desc' }, take: 1, select: { id: true } } },
    });
    return row === null ? null : { workflowId: row.workflowId, companyId: row.companyId, lastEventId: row.events[0]?.id ?? null };
  }

  async workflowDocuments(tx: TenantTransaction, tenantId: string, workflowId: string): Promise<WorkflowDocumentChoice[]> {
    const rows = await tx.workflowDocument.findMany({
      where: { tenantId, workflowId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        companyId: true,
        moment: true,
        isActive: true,
        format: { select: { name: true, isActive: true } },
        template: { select: { name: true, isActive: true, file: { select: { status: true } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.format?.name ?? row.template?.name ?? '',
      companyId: row.companyId,
      moment: row.moment,
      usable: row.isActive && (row.format !== null ? row.format.isActive : row.template !== null && row.template.isActive && row.template.file.status === 'CONFIRMED'),
    }));
  }

  /** The latest drawing request of each document of the ticket (finished ones are purged after a while). */
  async lastJobs(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<LastJob[]> {
    const rows = await tx.$queryRaw<Array<{ workflowDocumentId: string; status: OutboxStatus; createdAt: Date; payload: unknown }>>`
      SELECT DISTINCT ON (payload->>'workflowDocumentId')
             payload->>'workflowDocumentId' AS "workflowDocumentId", status, created_at AS "createdAt", payload
        FROM outbox_events
       WHERE tenant_id = ${tenantId}::uuid AND type = ${DOCUMENT_GENERATE_EVENT} AND payload->>'ticketId' = ${ticketId}
       ORDER BY payload->>'workflowDocumentId', created_at DESC, id DESC`;
    return rows;
  }
}
