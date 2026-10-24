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
    ['named colors and classes', '<p style="color:red" class="x">a</p>', '<p>a</p>'],
    ['an image, even a safe one', '<img src="https://example.com/x.png">ok', 'ok'],
  ])('drops %s', (_name, input, expected) => expect(sanitizeRichText(input)).toBe(expected));

  it('keeps tables (with their spans and widths), headings, underline and strike', () => {
    const table = '<table style="min-width: 75px"><colgroup><col style="min-width: 25px"></colgroup><tbody><tr><th colspan="2" rowspan="1"><p>Mes</p></th></tr><tr><td><p>Enero</p></td><td><p>1.250.000</p></td></tr></tbody></table>';
    expect(sanitizeRichText(table)).toBe(table.replace(/: /g, ':').replace('<col style="min-width:25px">', '<col style="min-width:25px" />'));
    expect(sanitizeRichText('<h2>Resumen</h2><p><u>firmado</u> y <s>pendiente</s></p>')).toBe('<h2>Resumen</h2><p><u>firmado</u> y <s>pendiente</s></p>');
  });

  it('keeps text and background colors and the alignment, with values of a known shape only', () => {
    expect(sanitizeRichText('<p style="text-align: center"><span style="color: #c0392b; background-color: rgb(255, 242, 204)">ojo</span></p>')).toBe('<p style="text-align:center"><span style="color:#c0392b;background-color:rgb(255, 242, 204)">ojo</span></p>');
    expect(sanitizeRichText('<td style="width: 120px">x</td>')).toBe('<td>x</td>');
  });

  it.each([
    ['a url in a color', '<span style="background-color: url(https://evil.test/x)">a</span>'],
    ['an expression', '<span style="color: expression(alert(1))">a</span>'],
    ['positioning', '<p style="position: fixed; top: 0; display: none">a</p>'],
    ['an import', '<span style="color: #fff; @import url(x)">a</span>'],
    ['a width outside tables', '<p style="width: 9999px">a</p>'],
  ])('drops styles that are not allowed: %s', (_name, input) => expect(sanitizeRichText(input)).not.toMatch(/url|expression|position|display|import|9999/));

  it('takes the empty paragraphs an editor leaves at the edges off, and an empty editor is empty', () => {
    expect(sanitizeRichText('<p></p>')).toBe('');
    expect(sanitizeRichText('<p><br></p><p>hola</p><p></p><p>chao</p><p><br /></p>')).toBe('<p>hola</p><p></p><p>chao</p>');
  });

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
