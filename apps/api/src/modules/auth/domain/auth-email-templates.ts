import { renderEmail } from '../../../infrastructure/mail/layout.js';
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
    ...renderEmail({ title: t.title, greeting: t.greeting(input.firstName), paragraphs: [t.request, t.validity(PASSWORD_RESET_VALIDITY_MINUTES), t.ignore], action: { label: t.action, url: input.url }, footer: es.footerAutomatic }),
  };
}

export function renderInvitationEmail(input: { firstName: string; organization: string; url: string }): RenderedMail {
  const t = es.invitation;
  return {
    subject: t.subject,
    ...renderEmail({ title: t.title, greeting: t.greeting(input.firstName), paragraphs: [t.invited(input.organization), t.validity(INVITATION_VALIDITY_DAYS), t.ignore], action: { label: t.action, url: input.url }, footer: es.footerAutomatic }),
  };
}

export function renderPlatformAdminInvitationEmail(input: { firstName: string; url: string }): RenderedMail {
  const t = es.platformAdminInvitation;
  return {
    subject: t.subject,
    ...renderEmail({ title: t.title, greeting: t.greeting(input.firstName), paragraphs: [t.invited, t.validity(PLATFORM_ADMIN_INVITATION_VALIDITY_DAYS), t.ignore], action: { label: t.action, url: input.url }, footer: es.footerAutomatic }),
  };
}

/** No link and no button: the owner is told, and acts through support. */
export function renderTenantDeletionEmail(input: { firstName: string; organization: string; purgeAfter: Date }): RenderedMail {
  const t = es.tenantDeletionRequested;
  const date = input.purgeAfter.toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' });
  return {
    subject: t.subject,
    ...renderEmail({ title: t.title, greeting: t.greeting(input.firstName), paragraphs: [t.requested(input.organization), t.deadline(date), t.contact], footer: es.footerAutomatic }),
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
  const paragraphs = [describeSecurityNotice(input.kind), t.when(formatNoticeDate(input.occurredAt, input.timeZone))];
  if (input.kind === 'PLATFORM_ADMIN_SIGN_IN') paragraphs.push(t.origin(input.origin?.ipAddress ?? t.unknown, input.origin?.userAgent ?? t.unknown));
  paragraphs.push(t.notYou);
  return {
    subject: t.subject[input.kind],
    ...renderEmail({ title: t.subject[input.kind], greeting: t.greeting(input.firstName), paragraphs, action: { label: t.action, url: input.resetUrl }, footer: es.footerAutomatic }),
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
  const paragraphs = [t.happened[input.kind](input.memberName, input.organization), es.securityNotice.when(formatNoticeDate(input.occurredAt, input.timeZone)), t.audit, t.unexpected];
  return {
    subject: t.subject[input.kind],
    ...renderEmail({ title: t.subject[input.kind], greeting: t.greeting(input.firstName), paragraphs, footer: es.footerAutomatic }),
  };
}

function describeSecurityNotice(kind: SecurityNoticeKind): string {
  const happened = es.securityNotice.happened;
  if (kind === 'ACCOUNT_LOCKED') return happened.ACCOUNT_LOCKED(LOGIN_LOCKOUT.lockMinutes);
  if (kind === 'MFA_LOCKED') return happened.MFA_LOCKED(MFA_POLICY.lockMinutes);
  return happened[kind];
}

function formatNoticeDate(date: Date, timeZone: string | null): string {
  const format = (zone: string) => `${date.toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: zone })} (${zone})`;
  try {
    return format(timeZone ?? DEFAULT_NOTICE_TIME_ZONE);
  } catch (error) {
    if (error instanceof RangeError) return format(DEFAULT_NOTICE_TIME_ZONE);
    throw error;
  }
}
