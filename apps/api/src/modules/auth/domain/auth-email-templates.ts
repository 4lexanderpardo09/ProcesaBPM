import { renderEmail } from '../../../infrastructure/mail/layout.js';
import { authMailEs as es } from '../i18n/es.js';

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
