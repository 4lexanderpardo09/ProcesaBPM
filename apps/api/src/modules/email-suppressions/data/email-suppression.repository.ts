import { Injectable } from '@nestjs/common';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { SuppressionNotice } from '../domain/ses-notification.js';

/** The API's door to the suppressions (§8.34): it records, and never reads them. */
@Injectable()
export class EmailSuppressionRepository {
  /** `true` when recorded; `false` for the same notification delivered again. */
  async record(tx: AuthTransaction, notice: SuppressionNotice): Promise<boolean> {
    const [row] = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT record_email_suppression(${notice.email}, ${notice.reason}::email_suppression_reason, ${notice.detail}, ${notice.feedbackId}) AS ok`;
    return row?.ok === true;
  }
}
