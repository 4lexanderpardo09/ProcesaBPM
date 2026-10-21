import { describe, expect, it } from 'vitest';
import { htmlToPlainText, plainTextToHtml } from './plain-text-html';

describe('plainTextToHtml', () => {
  it('turns blank lines into paragraphs and keeps single line breaks', () => {
    expect(plainTextToHtml('Hola equipo\r\nrevisen esto\n\nGracias')).toBe('<p>Hola equipo<br>revisen esto</p><p>Gracias</p>');
  });

  it('escapes whatever looks like markup', () => {
    expect(plainTextToHtml('a < b & "c" <script>')).toBe('<p>a &lt; b &amp; &quot;c&quot; &lt;script&gt;</p>');
  });

  it('trims the surrounding space', () => {
    expect(plainTextToHtml('  \n listo \n\n ')).toBe('<p>listo</p>');
  });
});

describe('htmlToPlainText', () => {
  it('undoes plainTextToHtml', () => {
    const text = 'Hola, <equipo>:\nrevisen esto.\n\nGracias & saludos';
    expect(htmlToPlainText(plainTextToHtml(text))).toBe(text);
  });

  it('keeps the text of other markup', () => {
    expect(htmlToPlainText('<p>Uno <strong>dos</strong></p><p class="x">tres</p>')).toBe('Uno dos\n\ntres');
  });
});
