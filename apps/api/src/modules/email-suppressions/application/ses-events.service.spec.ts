import { NotFoundError, PermissionDeniedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import { snsTestSigner } from '../../../../test/support/sns-test-signer.js';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { ApiConfig } from '../../../config/app-config.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import type { EmailSuppressionRepository } from '../data/email-suppression.repository.js';
import { SesEventsService } from './ses-events.service.js';
import type { SnsClient } from './sns-client.js';

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:procesabpm-ses-events';
const signer = snsTestSigner(TOPIC);

function service(topic: string | undefined) {
  const warn = vi.fn();
  const record = vi.fn(async () => true);
  const sns = { certificate: vi.fn(async () => signer.publicKeyPem), confirmSubscription: vi.fn() } as unknown as SnsClient;
  const runner = { withAnonymousTransaction: (work: (tx: unknown) => Promise<unknown>) => work({}) } as unknown as AuthTransactionRunner;
  const events = new SesEventsService(
    { SES_SNS_TOPIC_ARN: topic } as ApiConfig,
    sns,
    runner,
    { record } as unknown as EmailSuppressionRepository,
    { warn, info: vi.fn() } as unknown as JsonLogger,
    { now: () => new Date() } as Clock,
  );
  return { events, warn, record, sns };
}

const bounce = JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'ana@acme.co' }] } });

describe('SesEventsService', () => {
  it('does not exist without a configured topic', async () => {
    const { events, sns } = service(undefined);
    await expect(events.receive(JSON.stringify(signer.sign({ Type: 'Notification', Message: bounce })))).rejects.toBeInstanceOf(NotFoundError);
    expect(sns.certificate).not.toHaveBeenCalled();
  });

  it('refuses a forged message before touching the database, and logs why without the address', async () => {
    const { events, warn, record } = service(TOPIC);
    const forged = { ...signer.sign({ Type: 'Notification', Message: bounce }), Message: bounce.replace('ana', 'eve') };
    await expect(events.receive(JSON.stringify(forged))).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(record).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'ses.sns_refused', reason: 'BAD_SIGNATURE' }), 'SesEventsService');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('acme.co');
  });

  it('records each address of a genuine permanent bounce', async () => {
    const { events, record } = service(TOPIC);
    await events.receive(JSON.stringify(signer.sign({ Type: 'Notification', Message: bounce })));
    expect(record).toHaveBeenCalledWith({}, { email: 'ana@acme.co', reason: 'BOUNCE', detail: 'Permanent/General', feedbackId: null });
  });
});
