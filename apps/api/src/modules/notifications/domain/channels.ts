import type { NotificationEmailPolicyValue, NotificationTypeValue } from '@procesabpm/shared';

export interface Channels {
  readonly inApp: boolean;
  readonly email: boolean;
}

/** The organization's e-mail policy per type; a type without one keeps its built-in default. */
export type EmailPolicies = ReadonlyMap<NotificationTypeValue, NotificationEmailPolicyValue>;
export const NO_EMAIL_POLICIES: EmailPolicies = new Map();

/**
 * As in the help desk, a notice is mailed by default only when it hands someone work (an assignment); the others stay
 * in the app unless the person asks for them by e-mail too. A workflow's own notification block (`SYSTEM`) mails when
 * its author chose to. The storage warning is an alert to the administrators, not a ticket notice, so it keeps its e-mail.
 */
const MAILED_BY_DEFAULT: ReadonlySet<NotificationTypeValue> = new Set(['TICKET_ASSIGNED', 'STORAGE_QUOTA', 'SYSTEM']);

/** The policy a type has while the organization never chose one. */
export function builtInEmailPolicy(type: NotificationTypeValue): NotificationEmailPolicyValue {
  return MAILED_BY_DEFAULT.has(type) ? 'DEFAULT_ON' : 'DEFAULT_OFF';
}

export function defaultChannels(type: NotificationTypeValue, policies: EmailPolicies = NO_EMAIL_POLICIES): Channels {
  return { inApp: true, email: (policies.get(type) ?? builtInEmailPolicy(type)) === 'DEFAULT_ON' };
}

/** E-mail turned off by the organization, whatever the person chose. */
export function emailLocked(type: NotificationTypeValue, policies: EmailPolicies): boolean {
  return policies.get(type) === 'OFF';
}

/**
 * No stored preference means the defaults of the type, as the organization set them. A stored preference is the
 * person's own choice and wins, except that nothing is mailed while the organization turned the type's e-mail off.
 */
export function channelsFor(stored: ReadonlyMap<string, Channels>, userId: string, type: NotificationTypeValue, policies: EmailPolicies): Channels {
  const channels = stored.get(`${userId}:${type}`) ?? defaultChannels(type, policies);
  return emailLocked(type, policies) ? { inApp: channels.inApp, email: false } : channels;
}
