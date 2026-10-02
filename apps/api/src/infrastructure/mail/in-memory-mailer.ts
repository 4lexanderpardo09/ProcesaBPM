import { type MailMessage, Mailer } from './mailer.js';

/** Test double: keeps what was sent and can be told to fail. */
export class InMemoryMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  private failures: Error[] = [];
  private failuresTo = new Map<string, Error[]>();

  failNext(error: Error): void {
    this.failures.push(error);
  }

  /** Fails the next message sent to this address only (an event can mail several people). */
  failNextTo(address: string, error: Error): void {
    this.failuresTo.set(address, [...(this.failuresTo.get(address) ?? []), error]);
  }

  clear(): void {
    this.sent.length = 0;
    this.failures = [];
    this.failuresTo.clear();
  }

  async send(message: MailMessage): Promise<void> {
    const failure = this.failuresTo.get(message.to)?.shift() ?? this.failures.shift();
    if (failure !== undefined) throw failure;
    this.sent.push(message);
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
