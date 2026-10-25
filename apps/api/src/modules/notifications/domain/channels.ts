import type { NotificationTypeValue } from '@procesabpm/shared';

export interface Channels {
  readonly inApp: boolean;
  readonly email: boolean;
}

/**
 * As in the help desk, a notice is mailed by default only when it hands someone work (an assignment); the others stay
 * in the app unless the person asks for them by e-mail too. A workflow's own notification block (`SYSTEM`) mails when
 * its author chose to.
 */
const MAILED_BY_DEFAULT: ReadonlySet<NotificationTypeValue> = new Set(['TICKET_ASSIGNED', 'SYSTEM']);

export function defaultChannels(type: NotificationTypeValue): Channels {
  return { inApp: true, email: MAILED_BY_DEFAULT.has(type) };
}

/** No stored preference means the defaults of the type. */
export function channelsFor(stored: ReadonlyMap<string, Channels>, userId: string, type: NotificationTypeValue): Channels {
  return stored.get(`${userId}:${type}`) ?? defaultChannels(type);
}
