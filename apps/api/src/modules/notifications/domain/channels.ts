import type { NotificationTypeValue } from '@procesabpm/shared';

export interface Channels {
  readonly inApp: boolean;
  readonly email: boolean;
}

export const DEFAULT_CHANNELS: Channels = { inApp: true, email: true };

/** No stored preference means the defaults: in-app and e-mail on. */
export function channelsFor(stored: ReadonlyMap<string, Channels>, userId: string, type: NotificationTypeValue): Channels {
  return stored.get(`${userId}:${type}`) ?? DEFAULT_CHANNELS;
}
