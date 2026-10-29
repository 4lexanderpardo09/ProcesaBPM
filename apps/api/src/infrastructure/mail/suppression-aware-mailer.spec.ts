import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../common/logging/json-logger.js';
import { InMemoryMailer } from './in-memory-mailer.js';
import type { MailMessage } from './mailer.js';
import { SuppressionAwareMailer, SuppressionList } from './suppression-aware-mailer.js';

const message = (to: string): MailMessage => ({ to, subject: 'Hola', html: '<p>x</p>', text: 'x', messageId: `<m-${to}@procesabpm.com>` });

class FixedList extends SuppressionList {
  constructor(private readonly suppressed: readonly string[]) {
    super();
  }

  isSuppressed(address: string): Promise<boolean> {
    return Promise.resolve(this.suppressed.includes(address));
  }
}

describe('SuppressionAwareMailer', () => {
  it('sends to other addresses, and skips a suppressed one with a log line that names the message, not the address', async () => {
    const transport = new InMemoryMailer();
    const info = vi.fn();
    const mailer = new SuppressionAwareMailer(transport, new FixedList(['bounced@acme.co']), { info } as unknown as JsonLogger);
    await mailer.send(message('ok@acme.co'));
    await mailer.send(message('bounced@acme.co'));
    expect(transport.sent.map((sent) => sent.to)).toEqual(['ok@acme.co']);
    expect(info).toHaveBeenCalledWith('mail.suppressed', { event: 'mail.suppressed', messageId: '<m-bounced@acme.co@procesabpm.com>' });
  });
});
