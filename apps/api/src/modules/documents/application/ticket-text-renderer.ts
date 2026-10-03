import { Inject, Injectable } from '@nestjs/common';
import { expandNotificationText, PdfDesignInvalidError } from '@procesabpm/shared';
import { JsonLogger } from '../../../common/logging/json-logger.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { Clock } from '../../../infrastructure/clock.js';
import { DesignResolver } from '../domain/design-resolver.js';
import { RenderFactsLoader } from './render-facts.loader.js';

/**
 * Fills the placeholders (`{{ticket.number}}`, `{{field.CODE}}`…) of a text with one ticket's data, the same way its
 * documents do. Used by the notification blocks: their subject and body are written by the workflow's designers.
 */
@Injectable()
export class TicketTextRenderer {
  constructor(
    @Inject(RenderFactsLoader) private readonly facts: RenderFactsLoader,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JsonLogger) private readonly logger: JsonLogger,
  ) {}

  /**
   * The texts rendered in order, or `null` when the ticket no longer exists. A text that does not parse is returned as
   * written and logged (the step, never the text: neither the text nor the parser's message may reach the logs).
   */
  async render(tx: TenantTransaction, tenantId: string, ticketId: string, texts: readonly string[], origin: { readonly stepId: string }): Promise<string[] | null> {
    const loaded = await this.facts.load(tx, tenantId, ticketId, this.clock.now());
    if (loaded === null) return null;
    const resolver = new DesignResolver(loaded.facts);
    return texts.map((text, index) => {
      try {
        return resolver.evaluate(expandNotificationText(text), 'text');
      } catch (error) {
        if (!(error instanceof PdfDesignInvalidError)) throw error;
        this.logger.warn({ event: 'notification.text_unparsed', tenantId, stepId: origin.stepId, index }, 'TicketTextRenderer');
        return text;
      }
    });
  }
}
