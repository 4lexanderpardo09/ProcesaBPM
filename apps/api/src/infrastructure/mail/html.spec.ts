import { describe, expect, it } from 'vitest';
import { escapeHtml, html, SafeHtml, singleLine } from './html.js';
import { renderEmail } from './layout.js';

const ATTACK = `"><img src=x onerror=alert(1)><script>alert('x')</script>`;

describe('html', () => {
  it('escapes every interpolation, including quotes that would break out of an attribute', () => {
    const output = html`<a href="${ATTACK}">${ATTACK}</a>`.value;
    expect(output).not.toContain('<img');
    expect(output).not.toContain('<script');
    expect(output).toContain('&quot;&gt;&lt;img');
  });
  it('keeps SafeHtml as it is, and escapes numbers as text', () => {
    expect(html`<b>${new SafeHtml('<i>ok</i>')}</b>${5}`.value).toBe('<b><i>ok</i></b>5');
  });
  it('escapes the five dangerous characters', () => expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;'));
});

describe('singleLine', () => {
  it('removes line breaks and caps the length', () => {
    expect(singleLine('Subject\r\nBcc: evil@example.com')).toBe('Subject Bcc: evil@example.com');
    expect(singleLine('x'.repeat(500))).toHaveLength(150);
  });
});

describe('renderEmail', () => {
  const content = { title: 'Título', greeting: `Hola ${ATTACK}`, paragraphs: [`Ticket ${ATTACK}`], action: { label: 'Abrir', url: 'https://app.test/t?a=1&b=2' }, footer: 'Pie' };

  it('escapes user text in the HTML version and the link, and shows the raw text in the text version', () => {
    const { html: document, text } = renderEmail(content);
    expect(document).not.toContain('<img');
    expect(document).not.toContain('<script');
    expect(document).toContain('href="https://app.test/t?a=1&amp;b=2"');
    expect(text).toContain(`Hola ${ATTACK}`);
    expect(text).toContain('Abrir: https://app.test/t?a=1&b=2');
  });
  it('is a full document in Spanish with the button and the footer', () => {
    const { html: document } = renderEmail(content);
    expect(document).toMatch(/^<!doctype html><html lang="es">/);
    expect(document).toContain('Pie');
  });
  it('omits the button when there is no action', () => {
    const { action: _action, ...withoutAction } = content;
    expect(renderEmail(withoutAction).html).not.toContain('<a ');
  });
});
