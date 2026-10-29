import { Inject, Injectable } from '@nestjs/common';
import { JsonLogger } from '../../common/logging/json-logger.js';
import { WorkerTransactionRunner } from '../database/worker-transaction-runner.js';
import { type MailMessage, Mailer } from './mailer.js';

/** Whether the e-mail provider told us not to write to an address again (a permanent bounce or a complaint, §8.34). */
export abstract class SuppressionList {
  abstract isSuppressed(address: string): Promise<boolean>;
}

/** The worker asks about one address at a time (`worker_suppressed_email`): it can never list them. */
@Injectable()
export class DatabaseSuppressionList extends SuppressionList {
  constructor(@Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner) {
    super();
  }

  async isSuppressed(address: string): Promise<boolean> {
    const [row] = await this.runner.withoutTenant((tx) => tx.$queryRaw<Array<{ ok: boolean }>>`SELECT worker_suppressed_email(${address}) AS ok`);
    return row?.ok === true;
  }
}

/**
 * Sends through the transport unless the address is suppressed: writing again to an address that bounced for good or
 * complained only costs the sender's reputation (SES pauses accounts that bounce or get complaints too often). A skipped
 * message counts as done, so its event is not retried; the log line carries the message id, never the address.
 */
export class SuppressionAwareMailer extends Mailer {
  constructor(
    private readonly transport: Mailer,
    private readonly suppressions: SuppressionList,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    if (await this.suppressions.isSuppressed(message.to)) {
      this.logger.info('mail.suppressed', { event: 'mail.suppressed', messageId: message.messageId });
      return;
    }
    await this.transport.send(message);
  }
}
