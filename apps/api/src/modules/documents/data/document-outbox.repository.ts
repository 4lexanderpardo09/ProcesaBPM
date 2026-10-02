import { Injectable } from '@nestjs/common';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';
import { DOCUMENT_GENERATE_EVENT, type DocumentGeneratePayload } from '../application/document-generate.payload.js';

/** Each document to draw is its own outbox event: retried on its own, and the event id fixes the file it produces. */
@Injectable()
export class DocumentOutboxRepository {
  async enqueue(tx: WorkerTransaction, tenantId: string, payloads: readonly DocumentGeneratePayload[]): Promise<void> {
    if (payloads.length === 0) return;
    await tx.outboxEvent.createMany({ data: payloads.map((payload) => ({ tenantId, type: DOCUMENT_GENERATE_EVENT, payload })) });
  }
}
