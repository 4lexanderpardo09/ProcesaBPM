import { describe, expect, it } from 'vitest';
import { readSesNotification } from './ses-notification.js';

const bounce = (bounceType: string, recipients: string[]) =>
  JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType, bounceSubType: 'General', feedbackId: 'fb-1', bouncedRecipients: recipients.map((emailAddress) => ({ emailAddress, status: '5.1.1' })) } });

describe('readSesNotification', () => {
  it('turns a permanent bounce into one notice per address', () => {
    expect(readSesNotification(bounce('Permanent', ['a@acme.co', 'b@acme.co']))).toEqual({
      kind: 'BOUNCE',
      transient: false,
      notices: [
        { email: 'a@acme.co', reason: 'BOUNCE', detail: 'Permanent/General', feedbackId: 'fb-1' },
        { email: 'b@acme.co', reason: 'BOUNCE', detail: 'Permanent/General', feedbackId: 'fb-1' },
      ],
    });
  });

  it('suppresses nothing for a transient or undetermined bounce', () => {
    expect(readSesNotification(bounce('Transient', ['a@acme.co']))).toEqual({ kind: 'BOUNCE', transient: true, notices: [] });
    expect(readSesNotification(bounce('Undetermined', ['a@acme.co'])).notices).toEqual([]);
  });

  it('turns a complaint into notices, also when it comes through a configuration set (eventType)', () => {
    const complaint = { complaint: { complaintFeedbackType: 'abuse', feedbackId: 'fb-2', complainedRecipients: [{ emailAddress: 'c@acme.co' }] } };
    const expected = { kind: 'COMPLAINT', transient: false, notices: [{ email: 'c@acme.co', reason: 'COMPLAINT', detail: 'abuse', feedbackId: 'fb-2' }] };
    expect(readSesNotification(JSON.stringify({ notificationType: 'Complaint', ...complaint }))).toEqual(expected);
    expect(readSesNotification(JSON.stringify({ eventType: 'Complaint', ...complaint }))).toEqual(expected);
  });

  it('ignores deliveries, other events and text that is not JSON', () => {
    expect(readSesNotification(JSON.stringify({ notificationType: 'Delivery', delivery: {} }))).toEqual({ kind: 'OTHER', transient: false, notices: [] });
    expect(readSesNotification('Successfully validated SNS topic for Amazon SES event publishing.')).toEqual({ kind: 'OTHER', transient: false, notices: [] });
  });
});
