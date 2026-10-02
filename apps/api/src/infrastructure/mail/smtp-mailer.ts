import { createTransport, type Transporter } from 'nodemailer';
import { MailDeliveryError, type MailMessage, Mailer } from './mailer.js';

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string | undefined;
  readonly password?: string | undefined;
  readonly from: string;
}

const AUTH_FAILED = 535;

/** 5xx answers are final (bad address, rejected content) except a failed login, which is our own configuration. */
export function classifySmtpError(error: unknown): MailDeliveryError {
  const { responseCode, code } = (error ?? {}) as { responseCode?: unknown; code?: unknown };
  const label = typeof code === 'string' ? code : typeof responseCode === 'number' ? String(responseCode) : 'SMTP';
  // EENVELOPE / EMESSAGE are raised locally for an address or message that can never be sent.
  const permanent = (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600 && responseCode !== AUTH_FAILED) || code === 'EENVELOPE' || code === 'EMESSAGE';
  return new MailDeliveryError(permanent, label, { cause: error });
}

/** nodemailer over SMTP: Mailpit in development, any provider's SMTP relay in production. */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(
    private readonly settings: SmtpSettings,
    transport?: Transporter,
  ) {
    super();
    this.transport =
      transport ??
      createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        ...(settings.user === undefined ? {} : { auth: { user: settings.user, pass: settings.password } }),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: message.messageId,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch (error) {
      throw classifySmtpError(error);
    }
  }
}
