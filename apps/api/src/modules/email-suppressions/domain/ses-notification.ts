/** One address SES says not to write to again. */
export interface SuppressionNotice {
  readonly email: string;
  readonly reason: 'BOUNCE' | 'COMPLAINT';
  /** Bounce type and subtype (`Permanent/NoEmail`) or the complaint's feedback type (`abuse`), when SES says it. */
  readonly detail: string | null;
  readonly feedbackId: string | null;
}

/** What a notification says, for the log (never the addresses). */
export interface SesReading {
  readonly kind: 'BOUNCE' | 'COMPLAINT' | 'OTHER';
  /** A bounce that is not permanent (the mailbox was full, the server busy): SES retries those, nothing is suppressed. */
  readonly transient: boolean;
  readonly notices: readonly SuppressionNotice[];
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function addresses(recipients: unknown): string[] {
  return (Array.isArray(recipients) ? recipients : []).flatMap((recipient) => {
    const address = textOrNull(asRecord(recipient).emailAddress);
    return address === null ? [] : [address];
  });
}

/**
 * Reads an SES notification (the `Message` of an SNS notification): SES feedback notifications (`notificationType`) and
 * SES event publishing through a configuration set (`eventType`) carry the same `bounce` and `complaint` objects.
 * Permanent bounces and complaints give one notice per address; anything else gives none.
 */
export function readSesNotification(message: string): SesReading {
  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(JSON.parse(message));
  } catch {
    return { kind: 'OTHER', transient: false, notices: [] };
  }
  const type = parsed.notificationType ?? parsed.eventType;
  if (type === 'Bounce') {
    const bounce = asRecord(parsed.bounce);
    if (bounce.bounceType !== 'Permanent') return { kind: 'BOUNCE', transient: true, notices: [] };
    const detail = [textOrNull(bounce.bounceType), textOrNull(bounce.bounceSubType)].filter((part) => part !== null).join('/') || null;
    const feedbackId = textOrNull(bounce.feedbackId);
    return { kind: 'BOUNCE', transient: false, notices: addresses(bounce.bouncedRecipients).map((email) => ({ email, reason: 'BOUNCE', detail, feedbackId })) };
  }
  if (type === 'Complaint') {
    const complaint = asRecord(parsed.complaint);
    const detail = textOrNull(complaint.complaintFeedbackType);
    const feedbackId = textOrNull(complaint.feedbackId);
    return { kind: 'COMPLAINT', transient: false, notices: addresses(complaint.complainedRecipients).map((email) => ({ email, reason: 'COMPLAINT', detail, feedbackId })) };
  }
  return { kind: 'OTHER', transient: false, notices: [] };
}
