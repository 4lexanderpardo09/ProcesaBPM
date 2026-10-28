import { plainTextApproximation } from './draft-spec/rich-text.js';

/**
 * The text of a NOTIFICATION block uses the same placeholders as the PDF templates (`{{ticket.number}}`,
 * `{{field.AMOUNT|currency}}`…). The short form of a field, `{{AMOUNT}}`, is accepted too: it means `{{field.AMOUNT}}`.
 */
const SHORT_FIELD = /\{\{\s*([A-Z][A-Z0-9_]*)\s*(\|[^{}]*)?\}\}/g;

export function expandNotificationText(text: string): string {
  return text.replace(SHORT_FIELD, (_match, code: string, formatters: string | undefined) => `{{field.${code}${formatters ?? ''}}}`);
}

const HTML_TAG = /<\/?[a-z][^>]*>/i;

/**
 * A NOTIFICATION block's body as what it is: plain text, paragraphs separated by a blank line (the builder edits it so,
 * and the e-mail and the in-app notice read it so). Drafts written by «Crear con IA» until 2026-10-28 stored it as
 * paragraphs of HTML, and published versions keep it: their tags are turned back into text here, never shown.
 */
export function notificationBodyText(body: string): string {
  return HTML_TAG.test(body) ? (plainTextApproximation(body) ?? '') : body;
}
