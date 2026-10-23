/** A text and the selection to leave after editing it. */
export interface Edited {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Puts `mark` on both sides of the selection (`**` bold, `_` italics); with nothing selected, an empty pair to type in. */
export function wrapSelection(text: string, start: number, end: number, mark: string): Edited {
  const chosen = text.slice(start, end);
  // Spaces stay outside the marks: `** dos**` would not read as bold.
  const lead = chosen.length - chosen.trimStart().length;
  const trail = chosen.length - chosen.trimEnd().length;
  const inner = chosen.trim();
  const from = start + lead;
  const to = end - trail;
  const next = `${text.slice(0, from)}${mark}${inner}${mark}${text.slice(to)}`;
  return { text: next, start: from + mark.length, end: from + mark.length + inner.length };
}

/** Starts each line the selection touches with `- ` (or `1. `, `2. `…), so the block becomes a list. */
export function listLines(text: string, start: number, end: number, numbered: boolean): Edited {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const to = lineEnd === -1 ? text.length : lineEnd;
  const lines = text
    .slice(from, to)
    .split('\n')
    .map((line, index) => `${numbered ? `${String(index + 1)}. ` : '- '}${line.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '')}`);
  // A list is its own block: a blank line before it when it follows other text.
  const before = from > 0 && !text.slice(0, from).endsWith('\n\n') ? '\n' : '';
  const block = `${before}${lines.join('\n')}`;
  return { text: `${text.slice(0, from)}${block}${text.slice(to)}`, start: from + before.length, end: from + block.length };
}
