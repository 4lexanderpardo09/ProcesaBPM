import { describe, expect, it } from 'vitest';
import { InMemoryMailer } from './in-memory-mailer.js';
import type { MailMessage } from './mailer.js';
import { isReservedAddress, ReservedDomainMailer } from './reserved-domain-mailer.js';

const message = (to: string): MailMessage => ({ to, subject: 's', html: '<p>h</p>', text: 't', messageId: '<id@procesabpm.test>' });

describe('isReservedAddress', () => {
  it.each(['e2e.jefe@procesa-e2e.test', 'smoke-1@smoke.invalid', 'a@b.example', 'x@localhost', 'a@example.com', 'a@mail.example.org', 'A@SMOKE.INVALID.'])('%s is a test address', (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each(['alexander.pardo.dev@gmail.com', 'ventas@procesabpm.com', 'a@test.com', 'a@example.co', 'a@myexample.com'])('%s is a real address', (address) => {
    expect(isReservedAddress(address)).toBe(false);
  });
});

describe('ReservedDomainMailer', () => {
  it('sends real addresses through the provider and test addresses to the catcher', async () => {
    const real = new InMemoryMailer();
    const catcher = new InMemoryMailer();
    const mailer = new ReservedDomainMailer(real, catcher);
    await mailer.send(message('ana@empresa.co'));
    await mailer.send(message('e2e.jefe@procesa-e2e.test'));
    expect(real.sent.map((m) => m.to)).toEqual(['ana@empresa.co']);
    expect(catcher.sent.map((m) => m.to)).toEqual(['e2e.jefe@procesa-e2e.test']);
  });

  it('drops test addresses when there is no catcher', async () => {
    const real = new InMemoryMailer();
    await new ReservedDomainMailer(real, undefined).send(message('smoke-1@smoke.invalid'));
    expect(real.sent).toEqual([]);
  });
});
