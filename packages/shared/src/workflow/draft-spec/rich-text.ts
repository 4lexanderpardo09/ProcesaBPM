const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const LINE_BREAK = /<br\s*\/?>/gi;
const PARAGRAPH_TAG = /<\/?p>/gi;

/**
 * The plain text of rich text made only of paragraphs and line breaks (what `paragraphs` writes and the sanitizer
 * keeps), paragraphs separated by a blank line. `undefined` when it holds any other formatting (bold, lists, links,
 * tables…), which plain text would lose; `null` when there is no text.
 */
export function plainTextOf(html: string | null): string | null | undefined {
  if (html === null) return null;
  const tagless = html.replace(LINE_BREAK, '\n').replace(/<\/p>/gi, '\u0000').replace(PARAGRAPH_TAG, '');
  if (/<[^>]*>/.test(tagless)) return undefined;
  const unknownEntity = (tagless.match(/&[#a-z0-9]+;/gi) ?? []).some((entity) => ENTITIES[entity.toLowerCase()] === undefined);
  if (unknownEntity) return undefined;
  const text = tagless
    .replace(/&[#a-z0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()]!)
    .split('\u0000')
    .flatMap((paragraph) => paragraph.split(/\n\s*\n/))
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).join('\n').trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
  return text === '' ? null : text;
}
