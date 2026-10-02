import { Test, type TestingModule } from '@nestjs/testing';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { InMemoryMailer } from '../../src/infrastructure/mail/in-memory-mailer.js';
import type { MailMessage } from '../../src/infrastructure/mail/mailer.js';
import { Mailer } from '../../src/infrastructure/mail/mailer.js';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectTestDatabase } from './admin-api.js';

export const tokenOf = (message: MailMessage): string => /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1]!;

/** A worker (outbox dispatcher plus an in-memory mailbox) running next to the API under test; the test decides when it delivers. */
export class MailWorker {
  private constructor(
    readonly module: TestingModule,
    readonly dispatcher: OutboxDispatcher,
    readonly mailer: InMemoryMailer,
    private readonly db = connectTestDatabase(),
  ) {}

  static async start(): Promise<MailWorker> {
    const module = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await module.init();
    return new MailWorker(module, module.get(OutboxDispatcher), module.get(Mailer) as InMemoryMailer);
  }

  /**
   * Delivers everything that is due now (with `retries`, an event waiting out its backoff counts as due too), including the events that handlers queue while running (rounds repeat until one
   * finds nothing). Test files run side by side against one database and every worker claims the events of every tenant:
   * an event this worker did not claim may be in the hands of another file's worker, so it also waits until nothing is
   * being processed anywhere (the condition, not a fixed time), and drains again in case that work queued more.
   */
  async deliver({ retries = false }: { retries?: boolean } = {}): Promise<void> {
    const deadline = Date.now() + 30_000;
    do {
      for (let round = 0; round < 500; round += 1) {
        if (retries) await this.retryNow();
        if ((await this.dispatcher.runOnce()).claimed === 0) break;
      }
      if ((await this.inFlight()) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
  }

  /**
   * An event whose first attempt failed (a lock timeout or a deadlock under load, which the retry policy rightly treats as
   * transient) waits 30 s for its next attempt. A test that wants "everything delivered" must not wait for a backoff.
   */
  private async retryNow(): Promise<void> {
    for (const table of ['outbox_events', 'platform_outbox_events']) {
      await this.db.platform.query(`UPDATE ${table} SET available_at = now() WHERE status = 'PENDING' AND attempts > 0 AND available_at > now()`);
    }
  }

  /** Delivers until a message to `address` has arrived (the condition, not a fixed time); fails with a clear message otherwise. */
  async waitForMail(address: string, timeoutMs = 30_000): Promise<MailMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.deliver({ retries: true });
      const message = this.lastTo(address);
      if (message !== undefined) return message;
      if (Date.now() > deadline) throw new Error(`No message to ${address} after ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async inFlight(): Promise<number> {
    const { rows } = await this.db.platform.query<{ count: string }>(`SELECT count(*) FROM outbox_events WHERE status = 'PROCESSING'`);
    return Number(rows[0]!.count);
  }

  /** The last message sent to an address. */
  lastTo(address: string): MailMessage | undefined {
    return this.mailer.to(address).at(-1);
  }

  async close(): Promise<void> {
    await this.module.close();
    await this.db.close();
  }
}
