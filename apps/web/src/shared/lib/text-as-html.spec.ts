import { describe, expect, it } from 'vitest';
import { textAsHtml } from './text-as-html';

describe('textAsHtml', () => {
  it('keeps HTML as it is', () => {
    expect(textAsHtml('<p>Revisa el <strong>extracto</strong></p>')).toBe('<p>Revisa el <strong>extracto</strong></p>');
  });

  it('turns plain text into paragraphs with their line breaks, escaping what would read as a tag', () => {
    expect(textAsHtml('Revisa el monto < 5\ny el banco\n\n  Luego aprueba  ')).toBe('<p>Revisa el monto &lt; 5<br>y el banco</p><p>Luego aprueba</p>');
  });

  it('leaves entities the sanitizer wrote as they are', () => {
    expect(textAsHtml('Cartera &amp; cobro')).toBe('<p>Cartera &amp; cobro</p>');
  });

  it('is empty for blank text', () => {
    expect(textAsHtml('  \n ')).toBe('');
  });
});
