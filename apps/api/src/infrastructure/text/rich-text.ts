import sanitizeHtml from 'sanitize-html';

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h3', 'h4'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  parseStyleAttributes: false,
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true) },
};

/**
 * User HTML (ticket descriptions, comments, incident texts) reduced to an allowlist of formatting tags and
 * safe links. Everything else (scripts, event handlers, styles, other schemes) is dropped, never escaped
 * back into view. Empty input stays empty.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** A comment that sanitizes to nothing is no comment. */
export function sanitizeOptionalRichText(html: string | undefined): string | null {
  if (html === undefined) return null;
  const clean = sanitizeRichText(html);
  return clean === '' ? null : clean;
}
