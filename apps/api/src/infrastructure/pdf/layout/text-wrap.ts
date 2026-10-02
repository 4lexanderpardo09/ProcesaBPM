import type { TextMeasurer } from '../resolved-document.js';

/** Splits text into lines that fit `maxWidth`: at spaces, at newlines, and inside a word that is wider than a line. */
export function wrapText(text: string, maxWidth: number, size: number, bold: boolean, measurer: TextMeasurer): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measurer.width(candidate, size, bold) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') lines.push(current);
      current = '';
      let rest = word;
      while (measurer.width(rest, size, bold) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measurer.width(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

/** At most `max` lines: the last one ends in an ellipsis when something was cut. */
export function clampLines(lines: readonly string[], max: number, maxWidth: number, size: number, bold: boolean, measurer: TextMeasurer): string[] {
  if (lines.length <= max) return [...lines];
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!;
  while (last.length > 0 && measurer.width(`${last}…`, size, bold) > maxWidth) last = last.slice(0, -1);
  kept[max - 1] = `${last}…`;
  return kept;
}

export function alignedX(left: number, width: number, textWidth: number, align: 'LEFT' | 'CENTER' | 'RIGHT'): number {
  if (align === 'CENTER') return left + (width - textWidth) / 2;
  if (align === 'RIGHT') return left + width - textWidth;
  return left;
}
