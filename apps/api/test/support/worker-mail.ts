import { Test, type TestingModule } from '@nestjs/testing';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { InMemoryMailer } from '../../src/infrastructure/mail/in-memory-mailer.js';
import type { MailMessage } from '../../src/infrastructure/mail/mailer.js';
import { Mailer } from '../../src/infrastructure/mail/mailer.js';
import { OutboxDispatcher } from '../../src/infrastructure/outbox/outbox-dispatcher.js';
import { WorkerModule } from '../../src/worker.module.js';

export const tokenOf = (message: MailMessage): string => /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1]!;

/** A worker (outbox dispatcher plus an in-memory mailbox) running next to the API under test; the test decides when it delivers. */
export class MailWorker {
  private constructor(
    readonly module: TestingModule,
    readonly dispatcher: OutboxDispatcher,
    readonly mailer: InMemoryMailer,
  ) {}

  static async start(): Promise<MailWorker> {
    const module = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await module.init();
    return new MailWorker(module, module.get(OutboxDispatcher), module.get(Mailer) as InMemoryMailer);
  }

  /** Delivers everything that is due now, including the events that handlers queue while running (rounds repeat until one finds nothing). */
  async deliver(): Promise<void> {
    for (let round = 0; round < 500; round += 1) if ((await this.dispatcher.runOnce()).claimed === 0) return;
  }

  /** The last message sent to an address. */
  lastTo(address: string): MailMessage | undefined {
    return this.mailer.to(address).at(-1);
  }

  close(): Promise<void> {
    return this.module.close();
  }
}
