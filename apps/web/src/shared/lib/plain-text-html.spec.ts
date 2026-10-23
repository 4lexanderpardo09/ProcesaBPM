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

  it('understands bold, italics and links, and leaves snake_case and lone marks alone', () => {
    expect(plainTextToHtml('Pago **urgente**, ver _anexo_ en https://bank.test/a?b=1&c=2.')).toBe(
      '<p>Pago <strong>urgente</strong>, ver <em>anexo</em> en <a href="https://bank.test/a?b=1&amp;c=2">https://bank.test/a?b=1&amp;c=2</a>.</p>',
    );
    expect(plainTextToHtml('campo snake_case_name y 2 * 3 ** 4')).toBe('<p>campo snake_case_name y 2 * 3 ** 4</p>');
  });

  it('makes a list of a block whose every line starts like one', () => {
    expect(plainTextToHtml('Falta:\n\n- la cédula\n- el **RUT**\n\n1. firmar\n2) enviar')).toBe('<p>Falta:</p><ul><li>la cédula</li><li>el <strong>RUT</strong></li></ul><ol><li>firmar</li><li>enviar</li></ol>');
    expect(plainTextToHtml('- uno\nsin guion')).toBe('<p>- uno<br>sin guion</p>');
  });
});

describe('htmlToPlainText', () => {
  it('undoes plainTextToHtml', () => {
    const text = 'Hola, <equipo>:\nrevisen esto.\n\nGracias & saludos';
    expect(htmlToPlainText(plainTextToHtml(text))).toBe(text);
  });

  it('writes bold, italics and lists back as their marks, and keeps the text of other markup', () => {
    expect(htmlToPlainText('<p>Uno <strong>dos</strong> <u>x</u></p><p class="x">tres</p>')).toBe('Uno **dos** x\n\ntres');
    const text = 'Falta:\n\n- la cédula\n- el **RUT**\n\n1. firmar\n2. _enviar_';
    expect(htmlToPlainText(plainTextToHtml(text))).toBe(text);
  });
});
