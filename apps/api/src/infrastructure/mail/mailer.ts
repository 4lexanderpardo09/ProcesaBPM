export interface MailMessage {
  readonly to: string;
  /** Built from the catalog and the ticket number only: no names, titles or comments (subjects show up in lock screens and logs). */
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Deterministic per outbox event, so a duplicate delivery can be recognized by the receiver. */
  readonly messageId: string;
}

/** Port of the e-mail provider. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

/** The provider refused the message (`permanent`) or could not be reached; retrying only helps when it is not permanent. */
export class MailDeliveryError extends Error {
  override readonly name = 'MailDeliveryError';

  constructor(
    readonly permanent: boolean,
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(`Mail delivery failed (${code})`, options);
  }
}
