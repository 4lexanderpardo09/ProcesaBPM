import { type EmailFact, renderEmail } from '../../../infrastructure/mail/layout.js';
import type { MemberSecurityNoticeKind, SecurityNoticeKind } from '../../../infrastructure/outbox/platform-event-types.js';
import { authMailEs as es } from '../i18n/es.js';
import { LOGIN_LOCKOUT, MFA_POLICY } from './auth-policy.js';

export interface RenderedMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export const PASSWORD_RESET_VALIDITY_MINUTES = 30;
export const INVITATION_VALIDITY_DAYS = 7;
export const PLATFORM_ADMIN_INVITATION_VALIDITY_DAYS = 7;

export function renderPasswordResetEmail(input: { firstName: string; url: string }): RenderedMail {
  const t = es.passwordReset;
  return {
    subject: t.subject,
    ...renderEmail({
      overline: es.overline.account,
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.request],
      note: t.validity(PASSWORD_RESET_VALIDITY_MINUTES),
      action: { label: t.action, url: input.url },
      closing: [t.ignore],
      footer: es.footerAutomatic,
    }),
  };
}

export function renderInvitationEmail(input: { firstName: string; organization: string; url: string }): RenderedMail {
  const t = es.invitation;
  return {
    subject: t.subject,
    ...renderEmail({
      overline: es.overline.invitation,
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.invited(input.organization)],
      facts: [{ label: es.facts.organization, value: input.organization }],
      note: t.validity(INVITATION_VALIDITY_DAYS),
      action: { label: t.action, url: input.url },
      closing: [t.ignore],
      footer: es.footerAutomatic,
    }),
  };
}

export function renderPlatformAdminInvitationEmail(input: { firstName: string; url: string }): RenderedMail {
  const t = es.platformAdminInvitation;
  return {
    subject: t.subject,
    ...renderEmail({
      overline: es.overline.invitation,
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.invited],
      note: t.validity(PLATFORM_ADMIN_INVITATION_VALIDITY_DAYS),
      action: { label: t.action, url: input.url },
      closing: [t.ignore],
      footer: es.footerAutomatic,
    }),
  };
}

/** No link and no button: the owner is told, and acts through support. */
export function renderTenantDeletionEmail(input: { firstName: string; organization: string; purgeAfter: Date }): RenderedMail {
  const t = es.tenantDeletionRequested;
  const date = input.purgeAfter.toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' });
  return {
    subject: t.subject,
    ...renderEmail({
      overline: es.overline.organization,
      tone: 'danger',
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.requested(input.organization)],
      facts: [
        { label: es.facts.organization, value: input.organization },
        { label: es.facts.purgeOn, value: date },
      ],
      note: t.deadline(date),
      closing: [t.contact],
      footer: es.footerAutomatic,
    }),
  };
}

/** B17: the same facts as the deletion e-mail, 7 days and 1 day before the purge. No link: the owner acts through support. */
export function renderTenantPurgeReminderEmail(input: { firstName: string; organization: string; purgeAfter: Date; daysLeft: number }): RenderedMail {
  const t = es.tenantPurgeReminder;
  const date = input.purgeAfter.toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' });
  return {
    subject: t.subject(input.daysLeft),
    ...renderEmail({
      overline: es.overline.organization,
      tone: 'danger',
      title: t.title,
      greeting: t.greeting(input.firstName),
      paragraphs: [t.reminder(input.organization, date)],
      facts: [
        { label: es.facts.organization, value: input.organization },
        { label: es.facts.purgeOn, value: date },
      ],
      note: t.lastChance,
      closing: [t.contact],
      footer: es.footerAutomatic,
    }),
  };
}

/** The zone used when the user chose none, or the stored one is not a valid IANA zone. */
export const DEFAULT_NOTICE_TIME_ZONE = 'America/Bogota';

export interface SecurityNoticeInput {
  readonly kind: SecurityNoticeKind;
  readonly firstName: string;
  readonly occurredAt: Date;
  readonly timeZone: string | null;
  /** Only shown for a sign-in. */
  readonly origin?: { readonly ipAddress: string | null; readonly userAgent: string | null };
  /** The plain page that starts a password reset: never a link with a token. */
  readonly resetUrl: string;
}

/** Says what happened, when and (for a sign-in) from where. No token and no secret. */
export function renderSecurityNoticeEmail(input: SecurityNoticeInput): RenderedMail {
  const t = es.securityNotice;
  const facts: EmailFact[] = [{ label: es.facts.when, value: formatNoticeDate(input.occurredAt, input.timeZone) }];
  if (input.kind === 'PLATFORM_ADMIN_SIGN_IN') {
    facts.push({ label: es.facts.ipAddress, value: input.origin?.ipAddress ?? t.unknown, mono: true }, { label: es.facts.browser, value: input.origin?.userAgent ?? t.unknown });
  }
  return {
    subject: t.subject[input.kind],
    ...renderEmail({
      overline: es.overline.security,
      tone: 'warning',
      title: t.subject[input.kind],
      greeting: t.greeting(input.firstName),
      paragraphs: [describeSecurityNotice(input.kind)],
      facts,
      note: t.notYou,
      action: { label: t.action, url: input.resetUrl },
      footer: es.footerAutomatic,
    }),
  };
}

export interface MemberSecurityNoticeInput {
  readonly kind: MemberSecurityNoticeKind;
  readonly firstName: string;
  readonly organization: string;
  readonly memberName: string;
  readonly occurredAt: Date;
  readonly timeZone: string | null;
}

/** Tells an owner that support changed the security of one of the organization's members. No link: nothing to act on. */
export function renderMemberSecurityNoticeEmail(input: MemberSecurityNoticeInput): RenderedMail {
  const t = es.memberSecurityNotice;
  return {
    subject: t.subject[input.kind],
    ...renderEmail({
      overline: es.overline.security,
      tone: 'warning',
      title: t.subject[input.kind],
      greeting: t.greeting(input.firstName),
      paragraphs: [t.happened[input.kind](input.memberName, input.organization), t.audit],
      facts: [
        { label: es.facts.member, value: input.memberName },
        { label: es.facts.organization, value: input.organization },
        { label: es.facts.when, value: formatNoticeDate(input.occurredAt, input.timeZone) },
      ],
      closing: [t.unexpected],
      footer: es.footerAutomatic,
    }),
  };
}

function describeSecurityNotice(kind: SecurityNoticeKind): string {
  const happened = es.securityNotice.happened;
  if (kind === 'ACCOUNT_LOCKED') return happened.ACCOUNT_LOCKED(LOGIN_LOCKOUT.lockMinutes);
  if (kind === 'MFA_LOCKED') return happened.MFA_LOCKED(MFA_POLICY.lockMinutes);
  return happened[kind];
}

/** A date and time in the person's zone (or Bogotá when theirs is unknown or invalid), with the zone named. */
export function formatNoticeDate(date: Date, timeZone: string | null): string {
  const format = (zone: string) => `${date.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: zone })} (${zone})`;
  try {
    return format(timeZone ?? DEFAULT_NOTICE_TIME_ZONE);
  } catch (error) {
    if (error instanceof RangeError) return format(DEFAULT_NOTICE_TIME_ZONE);
    throw error;
  }
}
