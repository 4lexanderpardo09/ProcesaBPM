import { describe, expect, it } from 'vitest';
import { InMemoryMailer } from './in-memory-mailer.js';

const message = (to: string) => ({ to, subject: 's', html: '<p>h</p>', text: 't', messageId: `<${to}@x>` });

describe('InMemoryMailer', () => {
  it('keeps what was sent, by address', async () => {
    const mailer = new InMemoryMailer();
    await mailer.send(message('a@x.com'));
    await mailer.send(message('b@x.com'));
    expect(mailer.to('a@x.com')).toHaveLength(1);
  });
  it('failNext fails whoever is next; failNextTo fails only that address, once', async () => {
    const mailer = new InMemoryMailer();
    mailer.failNextTo('a@x.com', new Error('down'));
    await mailer.send(message('b@x.com'));
    await expect(mailer.send(message('a@x.com'))).rejects.toThrow('down');
    await mailer.send(message('a@x.com'));
    mailer.failNext(new Error('any'));
    await expect(mailer.send(message('c@x.com'))).rejects.toThrow('any');
    expect(mailer.sent.map((sent) => sent.to)).toEqual(['b@x.com', 'a@x.com']);
  });
});
