import sanitizeHtml from 'sanitize-html';

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i];
const ALIGN = [/^(left|right|center|justify)$/];
const SIZE = [/^\d{1,4}(\.\d+)?px$/];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h2', 'h3', 'h4', 'span', 'hr',
    // Tables, typed in the editor or pasted from a spreadsheet.
    'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: { a: ['href', 'rel', 'target'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], '*': ['style'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Only these declarations survive, each with a value of a known shape: nothing can load, position or hide anything.
  parseStyleAttributes: true,
  allowedStyles: {
    '*': { color: COLOR, 'background-color': COLOR, 'text-align': ALIGN },
    table: { width: SIZE, 'min-width': SIZE },
    col: { width: SIZE, 'min-width': SIZE },
  },
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true) },
};

/** The empty paragraphs an editor leaves at the start or the end (an empty editor is one of them) are not content. */
const EDGE_EMPTY_PARAGRAPHS = /^(\s*<p>(\s|<br\s*\/?>)*<\/p>)+|(<p>(\s|<br\s*\/?>)*<\/p>\s*)+$/g;

/**
 * User HTML (ticket descriptions, comments, incident texts) reduced to an allowlist of formatting tags, tables, safe
 * links and a few styles (text and background colors, alignment, table widths). Everything else (scripts, event
 * handlers, other styles, other schemes, images) is dropped, never escaped back into view. Empty input, or only empty
 * paragraphs, is empty.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim().replace(EDGE_EMPTY_PARAGRAPHS, '').trim();
}

/** A comment that sanitizes to nothing is no comment. */
export function sanitizeOptionalRichText(html: string | undefined): string | null {
  if (html === undefined) return null;
  const clean = sanitizeRichText(html);
  return clean === '' ? null : clean;
}
