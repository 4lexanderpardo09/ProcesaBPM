import { describe, expect, it } from 'vitest';
import { expandNotificationText } from './notification-text.js';

describe('expandNotificationText', () => {
  it('turns the short form of a field into the full path and keeps its formatters', () => {
    expect(expandNotificationText('Hola {{NAME}}, total {{ TOTAL|currency}}')).toBe('Hola {{field.NAME}}, total {{field.TOTAL|currency}}');
  });

  it('leaves full paths, ticket properties and plain text alone', () => {
    const text = 'Ticket {{ticket.number}}: {{field.AMOUNT}} {{lower}} {name}';
    expect(expandNotificationText(text)).toBe(text);
  });
});
