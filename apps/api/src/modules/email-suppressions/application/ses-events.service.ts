import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, PermissionDeniedError, ValidationFailedError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { ApiConfig } from '../../../config/app-config.js';
import { API_CONFIG } from '../../../config/tokens.js';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { EmailSuppressionRepository } from '../data/email-suppression.repository.js';
import { readSesNotification } from '../domain/ses-notification.js';
import { hasValidSignature, parseSnsMessage, precheck, type SnsMessage } from '../domain/sns-message.js';
import { SnsClient } from './sns-client.js';

/**
 * Amazon SES bounces and complaints, as SNS posts them (docs/operations/email-bounces.md). Nothing is believed before the
 * message proves it comes from our topic: the topic ARN is the configured one, the certificate is SNS's own and the
 * signature (version 1 or 2) checks out, and it is recent. Then a subscription is confirmed, or each permanently bounced
 * or complaining address is suppressed. The log carries ids and counts, never the addresses.
 */
@Injectable()
export class SesEventsService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(SnsClient) private readonly sns: SnsClient,
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(EmailSuppressionRepository) private readonly suppressions: EmailSuppressionRepository,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async receive(body: unknown): Promise<void> {
    const topicArn = this.config.SES_SNS_TOPIC_ARN;
    if (topicArn === undefined) throw new NotFoundError();
    const message = parseSnsMessage(body);
    if (message === undefined) throw new ValidationFailedError([{ path: '', message: 'Not an SNS message' }]);
    await this.authenticate(message, topicArn);

    if (message.Type === 'SubscriptionConfirmation') {
      await this.sns.confirmSubscription(message.SubscribeURL!);
      this.logger.info('ses.sns_subscription_confirmed', { event: 'ses.sns_subscription_confirmed', topicArn, messageId: message.MessageId });
      return;
    }
    if (message.Type === 'Notification') await this.record(message);
  }

  private async authenticate(message: SnsMessage, topicArn: string): Promise<void> {
    const refusal = precheck(message, topicArn, this.clock.now()) ?? (hasValidSignature(message, await this.sns.certificate(message.SigningCertURL)) ? undefined : 'BAD_SIGNATURE');
    if (refusal === undefined) return;
    this.logger.warn({ message: 'An SNS message was refused', event: 'ses.sns_refused', reason: refusal, messageId: message.MessageId }, 'SesEventsService');
    throw new PermissionDeniedError('The SNS message could not be authenticated');
  }

  private async record(message: SnsMessage): Promise<void> {
    const reading = readSesNotification(message.Message);
    const recorded = await this.runner.withAnonymousTransaction(async (tx) => {
      let count = 0;
      for (const notice of reading.notices) if (await this.suppressions.record(tx, notice)) count += 1;
      return count;
    });
    this.logger.info('ses.notification', { event: 'ses.notification', kind: reading.kind, transient: reading.transient, addresses: reading.notices.length, recorded, messageId: message.MessageId });
  }
}
