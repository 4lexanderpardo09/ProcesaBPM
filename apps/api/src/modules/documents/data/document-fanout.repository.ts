import { Injectable } from '@nestjs/common';
import { parseBlockConfig } from '@procesabpm/shared';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

export interface TicketRef {
  readonly workflowId: string;
  readonly companyId: string;
  readonly closedAt: Date | null;
}

export interface DocumentBlock {
  readonly workflowDocumentId: string;
  readonly role: 'MAIN_DOCUMENT' | 'STEP_DOCUMENT';
}

/** The little the fan-out needs to decide which documents a ticket event produces. */
@Injectable()
export class DocumentFanoutRepository {
  ticket(tx: TenantTransaction, tenantId: string, ticketId: string): Promise<TicketRef | null> {
    return tx.ticket.findFirst({ where: { tenantId, id: ticketId, deletedAt: null }, select: { workflowId: true, companyId: true, closedAt: true } });
  }

  async eventTime(tx: TenantTransaction, tenantId: string, ticketId: string, eventId: string): Promise<Date | null> {
    const event = await tx.ticketEvent.findFirst({ where: { tenantId, ticketId, id: eventId }, select: { createdAt: true } });
    return event?.createdAt ?? null;
  }

  /** The document a DOCUMENT block of the ticket's own workflow version asks for, or `null` when the block is not (or no longer) valid. */
  async documentBlock(tx: TenantTransaction, tenantId: string, ticketId: string, stepId: string): Promise<DocumentBlock | null> {
    const ticket = await tx.ticket.findFirst({ where: { tenantId, id: ticketId }, select: { workflowVersionId: true } });
    if (ticket === null) return null;
    const step = await tx.step.findFirst({ where: { tenantId, id: stepId, versionId: ticket.workflowVersionId, type: 'DOCUMENT' }, select: { config: true } });
    if (step === null) return null;
    const parsed = parseBlockConfig('DOCUMENT', step.config);
    return parsed.valid ? { workflowDocumentId: parsed.config.workflowDocumentId as string, role: parsed.config.role as DocumentBlock['role'] } : null;
  }
}
