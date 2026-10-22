import { type CanvasStyle } from '@procesabpm/shared';
import { clip, endPath, type PDFDocument, type PDFFont, type PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb, StandardFonts } from 'pdf-lib';
import type { CanvasMeasurer, CanvasOp } from './canvas-document.js';

type EmbeddedImage = Awaited<ReturnType<PDFDocument['embedPng']>>;

/** Points in a millimetre. */
const PT_PER_MM = 72 / 25.4;
const pt = (millimetres: number) => millimetres * PT_PER_MM;

const hexColor = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

/** Regular, bold, italic and bold italic of each family: the fonts every PDF reader has (no file to embed). */
const FAMILIES: Readonly<Record<CanvasStyle['font'], readonly [StandardFonts, StandardFonts, StandardFonts, StandardFonts]>> = {
  HELVETICA: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  TIMES: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  COURIER: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

type FontKey = Pick<CanvasStyle, 'font' | 'bold' | 'italic'>;

/**
 * The standard fonts of one document, embedded when first used. They cover Spanish (accents, ñ, ¿ ¡) and the euro
 * sign; a character they lack becomes `?` instead of failing the whole document.
 */
export class CanvasFonts {
  private readonly fonts = new Map<StandardFonts, { font: PDFFont; characters: ReadonlySet<number> }>();

  private constructor(private readonly document: PDFDocument) {}

  static async embedAll(document: PDFDocument): Promise<CanvasFonts> {
    const fonts = new CanvasFonts(document);
    // Embedding is cheap for a standard font (no file) and makes measuring synchronous.
    for (const family of Object.values(FAMILIES)) for (const name of family) await fonts.load(name);
    return fonts;
  }

  private async load(name: StandardFonts): Promise<void> {
    const font = await this.document.embedFont(name);
    this.fonts.set(name, { font, characters: new Set(font.getCharacterSet()) });
  }

  private entry(key: FontKey) {
    return this.fonts.get(FAMILIES[key.font][(key.bold ? 1 : 0) + (key.italic ? 2 : 0)]!)!;
  }

  font(key: FontKey): PDFFont {
    return this.entry(key).font;
  }

  safe(text: string, key: FontKey): string {
    const { characters } = this.entry(key);
    return [...text].map((character) => (characters.has(character.codePointAt(0)!) ? character : '?')).join('');
  }

  get measurer(): CanvasMeasurer {
    return { width: (text, style) => this.font(style).widthOfTextAtSize(this.safe(text, style), style.size) };
  }
}

/** A rectangle with round corners as an SVG path, in points from its top left corner (pdf-lib flips the y axis). */
function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  return `M ${r} 0 H ${width - r} A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r} A ${r} ${r} 0 0 1 ${width - r} ${height} H ${r} A ${r} ${r} 0 0 1 0 ${height - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

function withClip(page: PDFPage, x: number, y: number, width: number, height: number, draw: () => void): void {
  page.pushOperators(pushGraphicsState(), rectangle(pt(x), page.getHeight() - pt(y + height), pt(width), pt(height)), clip(), endPath());
  try {
    draw();
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

function drawImage(page: PDFPage, image: EmbeddedImage, op: Extract<CanvasOp, { kind: 'image' }>): void {
  const [boxWidth, boxHeight] = [pt(op.width), pt(op.height)];
  const left = pt(op.x);
  const bottom = page.getHeight() - pt(op.y + op.height);
  if (op.fit === 'STRETCH') return void page.drawImage(image, { x: left, y: bottom, width: boxWidth, height: boxHeight });
  const scale = op.fit === 'COVER' ? Math.max(boxWidth / image.width, boxHeight / image.height) : Math.min(boxWidth / image.width, boxHeight / image.height);
  const [width, height] = [image.width * scale, image.height * scale];
  withClip(page, op.x, op.y, op.width, op.height, () => page.drawImage(image, { x: left + (boxWidth - width) / 2, y: bottom + (boxHeight - height) / 2, width, height }));
}

const DASHES: Readonly<Record<'SOLID' | 'DASHED' | 'DOTTED', (thickness: number) => number[] | undefined>> = {
  SOLID: () => undefined,
  DASHED: (thickness) => [thickness * 4, thickness * 3],
  DOTTED: (thickness) => [thickness, thickness * 2],
};

/** Draws the operations of a laid out canvas on the pages of a document. */
export function drawCanvasOps(pages: readonly PDFPage[], ops: readonly CanvasOp[], fonts: CanvasFonts, images: ReadonlyMap<string, EmbeddedImage>): void {
  for (const op of ops) {
    const page = pages[op.page - 1];
    if (page === undefined) continue;
    const height = page.getHeight();
    switch (op.kind) {
      case 'box': {
        const fill = op.background === null ? undefined : hexColor(op.background);
        const border = op.border > 0 ? { borderColor: hexColor(op.borderColor), borderWidth: op.border } : {};
        if (op.radius > 0) page.drawSvgPath(roundedRectPath(pt(op.width), pt(op.height), pt(op.radius)), { x: pt(op.x), y: height - pt(op.y), ...(fill === undefined ? {} : { color: fill }), ...border });
        else page.drawRectangle({ x: pt(op.x), y: height - pt(op.y + op.height), width: pt(op.width), height: pt(op.height), ...(fill === undefined ? {} : { color: fill }), ...border });
        break;
      }
      case 'text': {
        const font = fonts.font(op.style);
        const color = hexColor(op.style.color);
        withClip(page, op.clip.x, op.clip.y, op.clip.width, op.clip.height, () => {
          for (const line of op.lines) {
            const baseline = height - pt(line.top) - op.style.size * 0.95;
            const text = fonts.safe(line.text, op.style);
            if (line.wordSpacing === 0) page.drawText(text, { x: pt(line.x), y: baseline, size: op.style.size, font, color });
            else {
              // A justified line: each word on its own, the spaces stretched.
              let x = pt(line.x);
              const space = font.widthOfTextAtSize(' ', op.style.size) + pt(line.wordSpacing);
              for (const word of text.split(' ')) {
                if (word !== '') page.drawText(word, { x, y: baseline, size: op.style.size, font, color });
                x += font.widthOfTextAtSize(word, op.style.size) + space;
              }
            }
            if (op.style.underline) {
              const y = baseline - op.style.size * 0.12;
              page.drawLine({ start: { x: pt(line.x), y }, end: { x: pt(line.x + line.width), y }, thickness: Math.max(0.4, op.style.size * 0.06), color });
            }
          }
        });
        break;
      }
      case 'line': {
        const dashArray = DASHES[op.dash](op.thickness);
        page.drawLine({ start: { x: pt(op.x1), y: height - pt(op.y1) }, end: { x: pt(op.x2), y: height - pt(op.y2) }, thickness: op.thickness, color: hexColor(op.color), ...(dashArray === undefined ? {} : { dashArray }) });
        break;
      }
      case 'image': {
        const image = images.get(op.imageKey);
        if (image !== undefined) drawImage(page, image, op);
        break;
      }
    }
  }
}

export { PT_PER_MM };
