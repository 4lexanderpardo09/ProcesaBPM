import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { SecurityNoticeKind } from '../../../infrastructure/outbox/platform-event-types.js';

/** Queues an `email.security_notice` through `enqueue_security_notice` (docs/base-de-datos.md §8.27), the event's only door. */
@Injectable()
export class SecurityNoticeRepository {
  /** `false` when nothing was queued: an unknown account, or a lock notice already sent in the last 24 hours. */
  async enqueue(tx: AuthTransaction, userId: string, kind: SecurityNoticeKind, sessionId: string | null): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ queued: boolean }>>`
      SELECT enqueue_security_notice(${userId}::uuid, ${kind}, ${sessionId}::uuid) AS queued`;
    return row?.queued === true;
  }
}
