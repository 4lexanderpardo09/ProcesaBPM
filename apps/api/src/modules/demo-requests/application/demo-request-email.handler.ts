import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import { type ClaimedEvent, type ExternalEffectHandler } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { DEMO_REQUEST_RECEIVED_EVENT, type DemoRequestReceivedPayload, demoRequestReceivedPayloadSchema } from '../../../infrastructure/outbox/platform-event-types.js';
import { DemoRequestMailRepository } from '../data/demo-request-mail.repository.js';
import { renderDemoRequestEmail } from '../domain/demo-request-email.js';

/** Mails a demo request to the sales inbox, with the person who asked as Reply-To. */
@Injectable()
export class DemoRequestEmailHandler implements ExternalEffectHandler<DemoRequestReceivedPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = DEMO_REQUEST_RECEIVED_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = demoRequestReceivedPayloadSchema;
  private readonly logger = new Logger(DemoRequestEmailHandler.name);

  constructor(
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(DemoRequestMailRepository) private readonly requests: DemoRequestMailRepository,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  /** Nothing to send without a sales inbox (the request is still in the console) or once retention deleted it. */
  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<DemoRequestReceivedPayload>): Promise<MailMessage | null> {
    const inbox = this.settings.SALES_INBOX_EMAIL;
    if (inbox === undefined) {
      this.logger.warn('SALES_INBOX_EMAIL is not set: the demo request is only listed in the platform console');
      return null;
    }
    const request = await this.requests.find(tx, event.payload.demoRequestId);
    if (request === undefined) return null;
    return { to: inbox, replyTo: request.email, ...renderDemoRequestEmail(request), messageId: `<${event.id}@${this.settings.MAIL_MESSAGE_ID_DOMAIN}>` };
  }

  async perform(message: MailMessage): Promise<void> {
    await this.mailer.send(message);
  }
}
