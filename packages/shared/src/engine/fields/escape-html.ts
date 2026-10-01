const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Plain user text as safe HTML: every tag is escaped and each line break becomes a paragraph. */
export function plainTextToHtml(text: string): string {
  if (text.trim() === '') return '';
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[&<>"']/g, (char) => ESCAPES[char]!))
    .map((line) => `<p>${line}</p>`)
    .join('');
}
