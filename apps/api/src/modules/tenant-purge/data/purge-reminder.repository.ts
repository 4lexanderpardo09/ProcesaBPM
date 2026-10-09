import { Injectable } from '@nestjs/common';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';

/** The reminders before a purge: one database function decides, records and queues them (the worker sees no tenant). */
@Injectable()
export class PurgeReminderRepository {
  /** How many reminder e-mails were queued. */
  async enqueueDue(tx: CrossTenantTransaction, limit: number): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ queued: number }>>`SELECT enqueue_due_purge_reminders(${limit}::int) AS queued`;
    return row?.queued ?? 0;
  }
}
