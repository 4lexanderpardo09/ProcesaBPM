import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../../config/worker-settings.js';
import type { CrossTenantTransaction } from '../../../infrastructure/database/transaction-scope.js';
import { WebLinks } from '../../../infrastructure/mail/links.js';
import { type MailMessage, Mailer } from '../../../infrastructure/mail/mailer.js';
import type { ClaimedEvent, ExternalEffectHandler } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { DATA_EXPORT_READY_EVENT, type DataExportReadyPayload, dataExportReadyPayloadSchema } from '../../../infrastructure/outbox/platform-event-types.js';
import { DataExportNoticeRepository } from '../data/data-export-notice.repository.js';
import { renderDataExportReadyEmail } from '../domain/data-export-ready-email.js';

/**
 * Tells the member who asked that the export is ready. The payload is only ids (strict); everything is read again when
 * the mail is sent, and nothing is sent unless `worker_data_export_notice` vouches for it. No link to the object.
 */
@Injectable()
export class DataExportReadyEmailHandler implements ExternalEffectHandler<DataExportReadyPayload, MailMessage, void, CrossTenantTransaction>, OnModuleInit {
  readonly type = DATA_EXPORT_READY_EVENT;
  readonly scope = 'platform' as const;
  readonly schema = dataExportReadyPayloadSchema;

  constructor(
    @Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(WebLinks) private readonly links: WebLinks,
    @Inject(DataExportNoticeRepository) private readonly notices: DataExportNoticeRepository,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.registerExternal(this);
  }

  async prepare(tx: CrossTenantTransaction, event: ClaimedEvent<DataExportReadyPayload>): Promise<MailMessage | null> {
    const notice = await this.notices.find(tx, event.payload);
    if (notice === undefined) return null;
    const mail = renderDataExportReadyEmail({ ...notice, pageUrl: this.links.dataExports(event.payload.tenantId) });
    return { to: notice.email, ...mail, messageId: `<${event.id}@${this.settings.MAIL_MESSAGE_ID_DOMAIN}>` };
  }

  async perform(message: MailMessage): Promise<void> {
    await this.mailer.send(message);
  }
}
