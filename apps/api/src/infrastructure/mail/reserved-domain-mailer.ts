import { Logger } from '@nestjs/common';
import { type MailMessage, Mailer } from './mailer.js';

/**
 * Names reserved for testing and documentation (RFC 2606 and RFC 6761): no real mailbox lives under them. The demo
 * organization's people (e2e.…@procesa-e2e.test) and the smoke test's (smoke-…@smoke.invalid) use them.
 */
const RESERVED_TLDS = ['test', 'example', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

export function isReservedAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.$/, '');
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return RESERVED_TLDS.includes(tld) || RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));
}

/**
 * Keeps test addresses away from the real provider: a message to one goes to the mail catcher (Mailpit) when there is
 * one, or is dropped with a log line. Sending them to a real provider would only bounce, and bounces cost the sender's
 * reputation (Amazon SES reviews, and can pause, accounts that bounce too much).
 */
export class ReservedDomainMailer extends Mailer {
  private readonly logger = new Logger(ReservedDomainMailer.name);

  constructor(
    private readonly real: Mailer,
    private readonly catcher: Mailer | undefined,
  ) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    if (!isReservedAddress(message.to)) return this.real.send(message);
    if (this.catcher !== undefined) return this.catcher.send(message);
    this.logger.log('A message to a test address was not sent (no mail catcher configured)');
  }
}
