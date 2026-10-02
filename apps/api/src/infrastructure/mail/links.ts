import { Inject, Injectable } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';

/**
 * Links to the web app. The one-time tokens travel in the URL fragment: it is never sent to a server, so it does
 * not end up in access logs or in a Referer header.
 */
@Injectable()
export class WebLinks {
  constructor(@Inject(WORKER_SETTINGS) private readonly settings: WorkerSettings) {}

  resetPassword(token: string): string {
    return this.build('/reset-password', undefined, token);
  }

  acceptInvitation(token: string): string {
    return this.build('/accept-invitation', undefined, token);
  }

  ticket(tenantId: string, ticketId: string): string {
    return this.build(`/tickets/${encodeURIComponent(ticketId)}`, { tenant: tenantId });
  }

  private build(path: string, query?: Record<string, string>, token?: string): string {
    const url = new URL(path, this.settings.WEB_BASE_URL);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    if (token !== undefined) url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }
}
