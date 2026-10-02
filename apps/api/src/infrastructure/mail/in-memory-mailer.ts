import { type MailMessage, Mailer } from './mailer.js';

/** Test double: keeps what was sent and can be told to fail. */
export class InMemoryMailer extends Mailer {
  readonly sent: MailMessage[] = [];
  private failures: Error[] = [];

  failNext(error: Error): void {
    this.failures.push(error);
  }

  clear(): void {
    this.sent.length = 0;
    this.failures = [];
  }

  async send(message: MailMessage): Promise<void> {
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    this.sent.push(message);
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}
