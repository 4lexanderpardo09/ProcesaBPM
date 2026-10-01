import { describe, expect, it } from 'vitest';
import { sanitizeOptionalRichText, sanitizeRichText } from './rich-text.js';

describe('sanitizeRichText', () => {
  it('keeps the formatting tags', () => {
    expect(sanitizeRichText('<p>Hello <strong>you</strong></p><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>')).toBe('<p>Hello <strong>you</strong></p><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>');
  });

  it.each([
    ['a script', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
    ['an event handler', '<p onclick="alert(1)">a</p>', '<p>a</p>'],
    ['an image with onerror', '<img src=x onerror=alert(1)>text', 'text'],
    ['an iframe', '<iframe src="https://evil.test"></iframe>ok', 'ok'],
    ['a style block', '<style>p{display:none}</style>ok', 'ok'],
    ['an svg with a script', '<svg><script>alert(1)</script></svg>ok', 'ok'],
    ['inline styles and classes', '<p style="color:red" class="x">a</p>', '<p>a</p>'],
  ])('drops %s', (_name, input, expected) => expect(sanitizeRichText(input)).toBe(expected));

  describe('links', () => {
    const link = (href: string) => sanitizeRichText(`<a href="${href}">go</a>`);
    it('keeps http, https and mailto, forcing rel and target', () => {
      expect(link('https://example.com/a?b=1')).toBe('<a href="https://example.com/a?b=1" rel="noopener noreferrer nofollow" target="_blank">go</a>');
      expect(link('mailto:me@example.com')).toContain('href="mailto:me@example.com"');
    });
    it.each(['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java&#x09;script:alert(1)', 'jav\tascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', '//evil.test/x', 'vbscript:x'])('drops the href %s', (href) => {
      expect(link(href)).not.toMatch(/href/i);
    });
    it('overwrites a rel and target the author sent', () => expect(sanitizeRichText('<a href="https://a.test" rel="opener" target="x">go</a>')).toBe('<a href="https://a.test" rel="noopener noreferrer nofollow" target="_blank">go</a>'));
  });

  it('copes with malformed markup and keeps text that looks like a tag escaped', () => {
    expect(sanitizeRichText('<p>unclosed <b>bold')).toBe('<p>unclosed <b>bold</b></p>');
    expect(sanitizeRichText('a < b and c > d')).toBe('a &lt; b and c &gt; d');
  });

  it('plain text stays as it is', () => expect(sanitizeRichText('just text')).toBe('just text'));
  it('empty stays empty', () => expect(sanitizeRichText('   ')).toBe(''));
});

describe('sanitizeOptionalRichText', () => {
  it('is null when there is nothing left', () => {
    expect(sanitizeOptionalRichText(undefined)).toBeNull();
    expect(sanitizeOptionalRichText('<script>x</script>')).toBeNull();
    expect(sanitizeOptionalRichText('<p>ok</p>')).toBe('<p>ok</p>');
  });
});
