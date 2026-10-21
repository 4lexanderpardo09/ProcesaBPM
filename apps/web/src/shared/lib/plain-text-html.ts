const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);

/** What a person typed, as the HTML the API keeps: escaped, blank lines as paragraphs and line breaks kept. */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Back to text for editing what was saved as HTML (by `plainTextToHtml` or older rich text): paragraphs become blank
 * lines and `<br>` line breaks; any other markup is dropped, its text kept.
 */
export function htmlToPlainText(html: string): string {
  const document = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n'), 'text/html');
  return (document.body.textContent ?? '').trim();
}
