/**
 * The text of a NOTIFICATION block uses the same placeholders as the PDF templates (`{{ticket.number}}`,
 * `{{field.AMOUNT|currency}}`…). The short form of a field, `{{AMOUNT}}`, is accepted too: it means `{{field.AMOUNT}}`.
 */
const SHORT_FIELD = /\{\{\s*([A-Z][A-Z0-9_]*)\s*(\|[^{}]*)?\}\}/g;

export function expandNotificationText(text: string): string {
  return text.replace(SHORT_FIELD, (_match, code: string, formatters: string | undefined) => `{{field.${code}${formatters ?? ''}}}`);
}
