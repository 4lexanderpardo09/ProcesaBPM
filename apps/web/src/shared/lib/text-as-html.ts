const TAG = /<\/?[a-z][^>]*>/i;
const ANGLES: Readonly<Record<string, string>> = { '<': '&lt;', '>': '&gt;' };

/**
 * Text that is HTML (written in the editor) as it is, and plain text from before the editor (typed in a text box) as
 * paragraphs, one per blank line, keeping its line breaks. Only `<` and `>` are escaped: the API's sanitizer already
 * wrote `&` as an entity, and a bare one reads the same as HTML.
 */
export function textAsHtml(text: string): string {
  if (TAG.test(text)) return text;
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => `<p>${paragraph.replace(/[<>]/g, (angle) => ANGLES[angle] ?? angle).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
