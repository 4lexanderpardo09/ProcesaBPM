import type { PDFFont } from 'pdf-lib';

/**
 * The width a text takes once drawn, in points. pdf-lib's `widthOfTextAtSize` subtracts the font's kerning pairs ("AY",
 * "PA"…), but `drawText` places every glyph at its full advance: measured that way, «POPAYÁN,» came out 3.6 pt short
 * and the next word of a justified line was drawn over its comma. Adding the characters one by one measures what is drawn.
 */
export function drawnWidth(font: PDFFont, text: string, size: number): number {
  let width = 0;
  for (const character of text) width += font.widthOfTextAtSize(character, size);
  return width;
}
