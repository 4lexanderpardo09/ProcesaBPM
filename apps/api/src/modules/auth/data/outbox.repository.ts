import { Injectable } from '@nestjs/common';
import type { Prisma } from '@procesabpm/db';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';

/** Side effects (e-mails) leave the transaction through the outbox; the worker sends them. */
@Injectable()
export class OutboxRepository {
  async enqueue(tx: TenantTransaction, tenantId: string, type: string, payload: Prisma.InputJsonObject): Promise<void> {
    await tx.outboxEvent.create({ data: { tenantId, type, payload } });
  }
}
