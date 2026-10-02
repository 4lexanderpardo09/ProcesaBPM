import { describe, expect, it } from 'vitest';
import { renderInvitationEmail, renderPasswordResetEmail } from './auth-email-templates.js';

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
});
