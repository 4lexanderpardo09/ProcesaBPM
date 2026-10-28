import { describe, expect, it } from 'vitest';
import { expandNotificationText, notificationBodyText } from './notification-text.js';

describe('expandNotificationText', () => {
  it('turns the short form of a field into the full path and keeps its formatters', () => {
    expect(expandNotificationText('Hola {{NAME}}, total {{ TOTAL|currency}}')).toBe('Hola {{field.NAME}}, total {{field.TOTAL|currency}}');
  });

  it('leaves full paths, ticket properties and plain text alone', () => {
    const text = 'Ticket {{ticket.number}}: {{field.AMOUNT}} {{lower}} {name}';
    expect(expandNotificationText(text)).toBe(text);
  });
});

describe('notificationBodyText', () => {
  it('leaves a plain body as it is, ampersands and less-than signs included', () => {
    expect(notificationBodyText('Hola {{ticket.number}}\n\nA & B < 3')).toBe('Hola {{ticket.number}}\n\nA & B < 3');
  });

  it('turns a body stored as paragraphs of HTML (older AI drafts) back into text, placeholders kept', () => {
    expect(notificationBodyText('<p>El cambio de turno quedó confirmado.</p>')).toBe('El cambio de turno quedó confirmado.');
    expect(notificationBodyText('<p>Ticket {{ticket.number}} &amp; listo</p><p>Línea 1<br>Línea 2</p>')).toBe('Ticket {{ticket.number}} & listo\n\nLínea 1\nLínea 2');
  });
});
