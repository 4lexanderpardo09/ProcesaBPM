import type { NotificationTypeValue } from '@procesabpm/shared';
import { notificationsEs as es } from '../i18n/es.js';

export interface NotificationText {
  readonly title: string;
  readonly body: string;
}

/** Plain text for the in-app list: the title says what happened, the body names the ticket. */
export function notificationText(type: NotificationTypeValue, ticket: { readonly number: string; readonly title: string }): NotificationText {
  return { title: es.titles[type](ticket.number), body: ticket.title };
}
