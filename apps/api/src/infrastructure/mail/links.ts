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

  /** The page where a person asks for a reset link: no token, safe to put in any e-mail. */
  forgotPassword(): string {
    return this.build('/forgot-password');
  }

  acceptInvitation(token: string): string {
    return this.build('/accept-invitation', undefined, token);
  }

  ticket(tenantId: string, ticketId: string): string {
    return this.build(`/tickets/${encodeURIComponent(ticketId)}`, { tenant: tenantId });
  }

  private build(path: string, query?: Record<string, string>, token?: string): string {
    // Relative to the base so that an app served under a path (https://host/app) keeps it.
    const base = this.settings.WEB_BASE_URL.endsWith('/') ? this.settings.WEB_BASE_URL : `${this.settings.WEB_BASE_URL}/`;
    const url = new URL(path.replace(/^\//, ''), base);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    if (token !== undefined) url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }
}
