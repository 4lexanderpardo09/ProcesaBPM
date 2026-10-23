const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+/;

/**
 * The light formatting a person can type, on escaped text: `**bold**`, `_italic_` (between spaces or punctuation, so a
 * `snake_case` word stays as it is) and web addresses as links.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
}

/** One block between blank lines: a list when every line starts like one, otherwise a paragraph with its line breaks. */
function block(lines: readonly string[]): string {
  if (lines.every((line) => BULLET.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(BULLET, ''))}</li>`).join('')}</ul>`;
  if (lines.every((line) => NUMBERED.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(NUMBERED, ''))}</li>`).join('')}</ol>`;
  return `<p>${lines.map((line) => inline(line.trim())).join('<br>')}</p>`;
}

/**
 * What a person typed, as the HTML the API keeps: escaped, blank lines as paragraphs and line breaks kept, with the
 * light formatting of `inline` and lists of lines that start with `- ` or `1. `.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => block(paragraph.trim().split('\n')))
    .join('');
}

/** The text of a node with the formatting `plainTextToHtml` understands written back as marks. */
function marked(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  const inner = () => [...node.childNodes].map(marked).join('');
  switch (node.tagName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return `**${inner()}**`;
    case 'EM':
    case 'I':
      return `_${inner()}_`;
    case 'UL':
      return [...node.children].map((item) => `- ${marked(item)}`).join('\n');
    case 'OL':
      return [...node.children].map((item, index) => `${String(index + 1)}. ${marked(item)}`).join('\n');
    default:
      return inner();
  }
}

const BLOCKS: ReadonlySet<string> = new Set(['P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H3', 'H4']);

/**
 * Back to text for editing what was saved as HTML (by `plainTextToHtml` or older rich text): paragraphs and lists become
 * blocks between blank lines, and bold, italics and lists are written as their marks; any other markup is dropped, its text kept.
 */
export function htmlToPlainText(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const blocks: string[] = [];
  let loose = '';
  for (const child of [...body.childNodes]) {
    if (child instanceof Element && BLOCKS.has(child.tagName)) {
      blocks.push(loose, marked(child));
      loose = '';
    } else loose += marked(child);
  }
  blocks.push(loose);
  return blocks
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .join('\n\n');
}
