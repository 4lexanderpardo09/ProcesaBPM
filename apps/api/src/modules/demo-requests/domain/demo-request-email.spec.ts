import { describe, expect, it } from 'vitest';
import { renderDemoRequestEmail } from './demo-request-email.js';

const input = { fullName: 'Laura <b>Méndez</b>', company: 'Distribuidora del Valle', email: 'laura@example.com', teamSize: 'FROM_101_TO_500' as const, process: null, createdAt: new Date('2026-10-28T15:30:00Z') };

describe('renderDemoRequestEmail', () => {
  it('names nobody in the subject and says who, from where and how many', () => {
    const mail = renderDemoRequestEmail(input);
    expect(mail.subject).toBe('Nuevo pedido de demo desde el sitio web');
    expect(mail.text).toContain('Laura <b>Méndez</b>, de Distribuidora del Valle, pidió una demo');
    expect(mail.text).toContain('101 a 500');
    expect(mail.text).toContain('No indicó qué proceso quiere ver.');
    expect(mail.text).toContain('10:30');
  });

  it('escapes what the person wrote in the HTML version', () => {
    const { html } = renderDemoRequestEmail(input);
    expect(html).not.toContain('<b>Méndez</b>');
    expect(html).toContain('&lt;b&gt;Méndez&lt;/b&gt;');
  });
});
