import { describe, expect, it } from 'vitest';
import { SECURITY_NOTICE_KINDS } from '../../../infrastructure/outbox/platform-event-types.js';
import { renderInvitationEmail, renderMemberSecurityNoticeEmail, renderPasswordResetEmail, renderSecurityNoticeEmail, renderTenantPurgeReminderEmail } from './auth-email-templates.js';

const ATTACK = `Ana "><script>alert(1)</script>`;

describe('account e-mails', () => {
  it('the reset mail has a fixed subject, the link in both versions and no markup injection', () => {
    const mail = renderPasswordResetEmail({ firstName: ATTACK, url: 'https://app.test/reset-password#token=abc' });
    expect(mail.subject).toBe('Restablece tu contraseña de ProcesaBPM');
    expect(mail.html).not.toContain('<script');
    expect(mail.html).toContain('https://app.test/reset-password#token=abc');
    expect(mail.text).toContain('https://app.test/reset-password#token=abc');
    expect(mail.text).toContain('30 minutos');
  });

  it('the invitation names the organization in the body only, escaped, never in the subject', () => {
    const mail = renderInvitationEmail({ firstName: 'Ana', organization: `Acme <b>S.A.</b>`, url: 'https://app.test/accept-invitation#token=abc' });
    expect(mail.subject).toBe('Te invitaron a ProcesaBPM');
    expect(mail.subject).not.toContain('Acme');
    expect(mail.html).toContain('Acme &lt;b&gt;S.A.&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>S.A.</b>');
    expect(mail.text).toContain('7 días');
  });

  describe('security notices', () => {
    const RESET_PAGE = 'https://app.test/forgot-password';
    const base = { firstName: 'Ana', occurredAt: new Date('2026-10-03T15:04:00Z'), timeZone: null, resetUrl: RESET_PAGE } as const;
    const origin = { ipAddress: '203.0.113.7', userAgent: 'Agent/1.0' };

    it.each(SECURITY_NOTICE_KINDS)('%s: Spanish text, a fixed subject without names, the plain reset page and no secret', (kind) => {
      const mail = renderSecurityNoticeEmail({ ...base, kind, firstName: ATTACK, origin });
      expect(mail.subject).not.toContain('Ana');
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.html).not.toContain('<script');
      expect(mail.text).toContain('Si no fuiste tú');
      expect(mail.text).toContain(RESET_PAGE);
      expect(mail.text).not.toMatch(/token|#|[A-Za-z0-9_-]{32,}/);
      expect([...mail.html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])).toEqual([RESET_PAGE]);
      expect(mail.text).toContain('3 de octubre de 2026');
    });

    it('shows where a platform sign-in came from, escaped', () => {
      const mail = renderSecurityNoticeEmail({ ...base, kind: 'PLATFORM_ADMIN_SIGN_IN', origin: { ipAddress: '203.0.113.7', userAgent: '<b>Agent</b>' } });
      expect(mail.text).toContain('203.0.113.7');
      expect(mail.html).toContain('&lt;b&gt;Agent&lt;/b&gt;');
      expect(mail.html).not.toContain('<b>Agent</b>');
    });

    it('says "desconocido" when the session has no origin', () => {
      const mail = renderSecurityNoticeEmail({ ...base, kind: 'PLATFORM_ADMIN_SIGN_IN', origin: { ipAddress: null, userAgent: null } });
      expect(mail.text).toContain('desconocido');
    });

    it.each(SECURITY_NOTICE_KINDS.filter((kind) => kind !== 'PLATFORM_ADMIN_SIGN_IN'))('%s does not show the origin', (kind) => {
      const mail = renderSecurityNoticeEmail({ ...base, kind, origin });
      expect(mail.text).not.toContain('203.0.113.7');
      expect(mail.text).not.toContain('Agent/1.0');
    });

    it('tells how long a lock lasts', () => {
      expect(renderSecurityNoticeEmail({ ...base, kind: 'ACCOUNT_LOCKED' }).text).toContain('15 minutos');
      expect(renderSecurityNoticeEmail({ ...base, kind: 'MFA_LOCKED' }).text).toContain('15 minutos');
    });

    it('a reset mail says the password was reset; a change mail says it was changed', () => {
      expect(renderSecurityNoticeEmail({ ...base, kind: 'PASSWORD_RESET' }).subject).toContain('restableció');
      expect(renderSecurityNoticeEmail({ ...base, kind: 'PASSWORD_CHANGED' }).subject).toContain('cambió');
    });

    it('writes the date in the user’s zone, and in Bogotá when it has none or an invalid one', () => {
      expect(renderSecurityNoticeEmail({ ...base, kind: 'MFA_ENABLED', timeZone: 'Europe/Madrid' }).text).toContain('(Europe/Madrid)');
      expect(renderSecurityNoticeEmail({ ...base, kind: 'MFA_ENABLED', timeZone: null }).text).toContain('10:04');
      expect(renderSecurityNoticeEmail({ ...base, kind: 'MFA_ENABLED', timeZone: 'Not/AZone' }).text).toContain('(America/Bogota)');
    });

    it('the reset by support says the identity was verified and every session was closed', () => {
      const mail = renderSecurityNoticeEmail({ ...base, kind: 'MFA_RESET_BY_SUPPORT' });
      expect(mail.text).toContain('verificar tu identidad');
      expect(mail.text).toContain('sesiones se cerraron');
    });
  });

  describe('notice to an owner about a member', () => {
    const input = {
      kind: 'MEMBER_MFA_RESET_BY_SUPPORT',
      firstName: 'Olga',
      organization: 'Acme <b>S.A.</b>',
      memberName: ATTACK,
      occurredAt: new Date('2026-10-03T15:04:00Z'),
      timeZone: null,
    } as const;

    it('names the member and the organization in the body only, escaped, never in the subject', () => {
      const mail = renderMemberSecurityNoticeEmail(input);
      expect(mail.subject).toBe('Soporte restableció la verificación en dos pasos de un miembro de tu organización');
      expect(mail.html).not.toContain('<script');
      expect(mail.html).toContain('Acme &lt;b&gt;S.A.&lt;/b&gt;');
      expect(mail.text).toContain('Acme <b>S.A.</b>');
      expect(mail.text).toContain('Hola Olga,');
      expect(mail.text).toContain('auditoría');
      expect(mail.text).toContain('10:04');
    });

    it('carries no link, no button and nothing secret-looking', () => {
      const mail = renderMemberSecurityNoticeEmail({ ...input, memberName: 'Ana Ruiz' });
      expect(mail.html).not.toContain('href=');
      expect(mail.text).not.toMatch(/https?:|token|[A-Za-z0-9_-]{32,}/);
    });
  });

  it('the purge reminder says how long is left, the organization and the date, with no link and no markup injection', () => {
    const purgeAfter = new Date(Date.UTC(2026, 10, 9, 15));
    const week = renderTenantPurgeReminderEmail({ firstName: ATTACK, organization: ATTACK, purgeAfter, daysLeft: 7 });
    expect(week.subject).toBe('Tu organización se borra en 7 días');
    expect(renderTenantPurgeReminderEmail({ firstName: 'Ana', organization: 'Acme', purgeAfter, daysLeft: 1 }).subject).toBe('Mañana se borra tu organización');
    expect(week.text).toContain('9 de noviembre de 2026');
    expect(week.html).not.toContain('<script');
    expect(week.html).not.toContain('href=');
    expect(week.text).not.toMatch(/https?:/);
  });
});
