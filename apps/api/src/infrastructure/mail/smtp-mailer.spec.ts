import type { Transporter } from 'nodemailer';
import { createTransport } from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { MailDeliveryError } from './mailer.js';
import { classifySmtpError, SmtpMailer } from './smtp-mailer.js';

const settings = { host: 'localhost', port: 1025, secure: false, from: 'ProcesaBPM <no-reply@procesabpm.test>' };
const message = { to: 'ana@example.com', subject: 'Asunto', html: '<p>Hola</p>', text: 'Hola', messageId: '<evt-1@procesabpm.test>' };

describe('SmtpMailer', () => {
  it('builds a complete RFC 5322 message with the deterministic Message-ID', async () => {
    const transport = createTransport({ streamTransport: true, buffer: true });
    await new SmtpMailer(settings, transport).send(message);
    const info = await transport.sendMail({ ...message, from: settings.from });
    const raw = (info as unknown as { message: Buffer }).message.toString();
    expect(raw).toContain('To: ana@example.com');
    expect(raw).toContain('Subject: Asunto');
    expect(raw).toContain('multipart/alternative');
  });

  it('passes the message id and the sender to the transport', async () => {
    const sent: unknown[] = [];
    const transport = { sendMail: async (options: unknown) => void sent.push(options) } as unknown as Transporter;
    await new SmtpMailer(settings, transport).send(message);
    expect(sent[0]).toMatchObject({ from: settings.from, to: 'ana@example.com', messageId: '<evt-1@procesabpm.test>', headers: { 'Auto-Submitted': 'auto-generated' } });
  });

  it('wraps a failure in a MailDeliveryError', async () => {
    const transport = { sendMail: async () => Promise.reject(Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 })) } as unknown as Transporter;
    await expect(new SmtpMailer(settings, transport).send(message)).rejects.toMatchObject({ name: 'MailDeliveryError', permanent: true, code: '550' });
  });
});

describe('classifySmtpError', () => {
  it.each([
    [{ responseCode: 550 }, true],
    [{ responseCode: 553 }, true],
    [{ responseCode: 535 }, false],
    [{ responseCode: 451 }, false],
    [{ code: 'ETIMEDOUT' }, false],
    [{ code: 'ECONNREFUSED' }, false],
    [new Error('boom'), false],
  ])('%j is permanent: %s', (error, permanent) => {
    const result = classifySmtpError(error);
    expect(result).toBeInstanceOf(MailDeliveryError);
    expect(result.permanent).toBe(permanent);
  });
});
