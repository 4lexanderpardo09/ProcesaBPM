import { type CanvasStyle, PDF_LIMITS } from '@procesabpm/shared';
import type { CanvasContent, CanvasMeasurer, CanvasOp, PageFrame, PlacedLine, ResolvedCanvasElement, ResolvedSigner, TextStyle } from '../canvas-document.js';
import { RenderLimitError } from './flow-layout.js';
import { wrapText } from './text-wrap.js';

/** Millimetres in a point. */
const MM_PER_PT = 25.4 / 72;
const toMm = (points: number) => points * MM_PER_PT;
const toPt = (millimetres: number) => millimetres / MM_PER_PT;

/** Space between what repeats at the top and where content continues on the next page, mm. */
const CONTINUE_GAP = 3;
/** A group that jumps to the next page with what is glued above it is never taller than this part of the page. */
const GLUED_GROUP_SHARE = 1 / 3;
/** Several signers share a box in columns of at least this width, mm. */
const SIGNATURE_COLUMN_MIN = 40;
const SIGNATURE_GREY = '#4B5563';
const EMPTY_TABLE_GREY = '#6B7280';
const TOTAL_BACKGROUND = '#F3F4F6';
const EPSILON = 1e-6;

type TableElement = Extract<ResolvedCanvasElement, { type: 'table' }>;
type SignatureElement = Extract<ResolvedCanvasElement, { type: 'signature' }>;

/** An element (or a piece of a table) placed on a page; `designY`/`designEnd` are its box in the design, to drag what is glued to it. */
interface Placed {
  readonly order: number;
  page: number;
  y: number;
  readonly height: number;
  readonly designY?: number;
  readonly designEnd?: number;
  readonly draw: (page: number, y: number, height: number, frame: PageFrame) => CanvasOp[];
}

interface TableRow {
  readonly cells: ReadonlyArray<string | null>;
  readonly height: number;
  readonly kind: 'header' | 'body' | 'total' | 'empty';
  readonly odd: boolean;
}

export interface CanvasLayout {
  readonly pageCount: number;
  readonly ops: readonly CanvasOp[];
}

/**
 * Lays a canvas out. Each element keeps the place and size it was given; only what depends on the data moves: a table
 * with more rows than its box, or a text that grows, pushes down what is below it (what is beside it stays) and, when
 * the page is full, goes on to the next one with the table header repeated. Elements that repeat are drawn on every
 * page and keep their room: those in the top half act as a header, those in the bottom half as a footer.
 */
export function layoutCanvas(content: CanvasContent, measurer: CanvasMeasurer, deadlineAt?: number): CanvasLayout {
  return new CanvasLayouter(content, measurer, deadlineAt).run();
}

class CanvasLayouter {
  private readonly placed: Placed[] = [];
  private readonly limit: number;
  private readonly continueAt: number;

  constructor(
    private readonly content: CanvasContent,
    private readonly measurer: CanvasMeasurer,
    private readonly deadlineAt: number | undefined,
  ) {
    const { page } = content;
    const half = page.height / 2;
    const repeated = content.elements.filter((element) => element.repeat);
    const top = repeated.filter((element) => element.y < half);
    const bottom = repeated.filter((element) => element.y >= half);
    const normal = content.elements.filter((element) => !element.repeat);
    this.continueAt = top.length > 0 ? Math.max(...top.map((element) => element.y + element.height)) + CONTINUE_GAP : Math.min(10, ...normal.map((element) => Math.max(0, element.y)));
    this.limit = Math.min(page.height - page.marginBottom, ...bottom.map((element) => element.y - 2));
  }

  run(): CanvasLayout {
    const normal = this.content.elements.filter((element) => !element.repeat).sort((left, right) => left.y - right.y || left.x - right.x);
    // Each sheet starts on a new page, after the last page the previous one took (its tables may have grown).
    let firstPage = 1;
    for (const sheet of this.content.sheets) {
      this.placeSheet(
        normal.filter((element) => element.sheet === sheet),
        firstPage,
      );
      firstPage = Math.max(firstPage, ...this.placed.filter((item) => item.page >= firstPage).map((item) => item.page)) + 1;
    }
    const pageCount = Math.max(1, firstPage - 1);
    if (pageCount > PDF_LIMITS.maxPages) throw new RenderLimitError('PAGES');

    const repeated = this.content.elements.filter((element) => element.repeat);
    const ops: CanvasOp[] = [];
    for (let page = 1; page <= pageCount; page++) {
      this.checkDeadline();
      const frame = { page, pages: pageCount };
      const onPage: Placed[] = [
        ...this.placed.filter((item) => item.page === page),
        ...repeated.map((element): Placed => ({ order: element.order, page, y: element.y, height: element.height, draw: (p, y, height, f) => this.draw(element, p, y, height, f) })),
      ].sort((left, right) => left.order - right.order);
      for (const item of onPage) ops.push(...item.draw(page, item.y, item.height, frame));
    }
    return { pageCount, ops };
  }

  private checkDeadline(): void {
    if (this.deadlineAt !== undefined && Date.now() > this.deadlineAt) throw new RenderLimitError('TIMEOUT');
  }

  /**
   * Places the elements of one sheet from `firstPage` on. From the design coordinate `from`, elements go on `page`
   * moved by `shift` (what the tables above them grew).
   */
  private placeSheet(elements: readonly ResolvedCanvasElement[], firstPage: number): void {
    const breaks: Array<{ from: number; page: number; shift: number }> = [{ from: -Infinity, page: firstPage, shift: 0 }];
    const breakAt = (y: number) => breaks.reduce((best, entry) => (entry.from <= y + EPSILON && entry.from >= best.from ? entry : best), breaks[0]!);

    for (const element of elements) {
      this.checkDeadline();
      const current = breakAt(element.y);
      let page = current.page;
      let y = element.y + current.shift;

      if (element.type === 'table') {
        const widths = this.columnWidths(element);
        const rows = this.tableRows(element, widths);
        const firstRows = (rows.header?.height ?? 0) + rows.body[0]!.height;
        if (y > this.continueAt && y + firstRows > this.limit) {
          const top = this.dragGlued(element.y, page);
          page += 1;
          breaks.push({ from: top, page, shift: this.continueAt - top });
          y = element.y + this.continueAt - top;
        }
        const end = this.placeTable(element, widths, rows, page, y);
        // What is below keeps its distance to the real end of the table; the box drawn in the editor is its least height.
        const designEnd = element.y + element.height;
        const effectiveEnd = end.page === page ? Math.max(end.y, y + element.height) : end.y;
        breaks.push({ from: designEnd, page: end.page, shift: effectiveEnd - designEnd });
        continue;
      }

      const height = this.realHeight(element);
      if (y + height > this.limit && height <= this.limit - this.continueAt && y > this.continueAt) {
        // It does not fit: it goes to the next page with what is glued above it, and drags what is below.
        const top = this.dragGlued(element.y, page);
        page += 1;
        breaks.push({ from: top, page, shift: this.continueAt - top });
        y = element.y + this.continueAt - top;
      }
      if (height > element.height + 0.01) breaks.push({ from: element.y + element.height, page, shift: y + height - (element.y + element.height) });
      this.placed.push({ order: element.order, page, y, height, designY: element.y, designEnd: element.y + element.height, draw: (p, yy, hh, frame) => this.draw(element, p, yy, hh, frame) });
    }
  }

  /**
   * When something jumps to the next page, what is glued right above it (a section title on top of a table) jumps
   * with it: a title is never left alone at the bottom of a page. Returns the design coordinate the group starts at.
   */
  private dragGlued(fromDesign: number, page: number): number {
    let top = fromDesign;
    for (;;) {
      const glued = this.placed.filter((item) => item.page === page && item.designEnd !== undefined && item.designY! < top && Math.abs(item.designEnd - top) < 1);
      if (glued.length === 0) break;
      const newTop = Math.min(...glued.map((item) => item.designY!));
      if (fromDesign - newTop > (this.limit - this.continueAt) * GLUED_GROUP_SHARE) break;
      top = newTop;
    }
    if (top < fromDesign) {
      for (const item of this.placed) {
        if (item.page === page && item.designY !== undefined && item.designY >= top - EPSILON && item.designY < fromDesign) {
          item.page = page + 1;
          item.y = this.continueAt + (item.designY - top);
        }
      }
    }
    return top;
  }

  // --- Measuring -------------------------------------------------------------------------------------------------

  /** Lines of a text in a box of `width` mm (padding included), each paragraph's last line marked for justification. */
  private wrap(text: string, style: CanvasStyle, width: number): Array<{ text: string; last: boolean }> {
    const available = toPt(Math.max(0.1, width - style.padding * 2));
    const measurer = { width: (piece: string, size: number) => this.measurer.width(piece, { ...style, size }) };
    return text.split('\n').flatMap((paragraph) => {
      const lines = wrapText(paragraph, available, style.size, style.bold, measurer);
      return lines.map((line, index) => ({ text: line, last: index === lines.length - 1 }));
    });
  }

  /** Height of one line, mm: the font size plus a little, plus the extra of a double spacing. */
  private lineAdvance(style: Pick<CanvasStyle, 'size' | 'lineHeight'>): number {
    return toMm(style.size * (style.lineHeight + 0.2));
  }

  private textHeight(text: string, style: CanvasStyle, width: number): number {
    if (text === '') return 0;
    return this.wrap(text, style, width).length * this.lineAdvance(style);
  }

  /** Final height of an element that is not a table: a text that grows may be taller than its box. */
  private realHeight(element: ResolvedCanvasElement): number {
    if (element.type !== 'text' || !element.grow) return element.height;
    return Math.max(element.height, this.textHeight(element.text(undefined), element.style, element.width) + element.style.padding * 2);
  }

  // --- Tables ----------------------------------------------------------------------------------------------------

  private columnWidths(element: TableElement): number[] {
    const total = element.columns.reduce((sum, column) => sum + column.weight, 0);
    return element.columns.map((column) => (element.width * column.weight) / total);
  }

  private tableRows(element: TableElement, widths: readonly number[]): { header: TableRow | null; body: TableRow[]; total: TableRow | null } {
    if (element.rows.length > PDF_LIMITS.maxTableRows) throw new RenderLimitError('ROWS');
    const height = (cells: ReadonlyArray<string | null>, style: CanvasStyle, span?: number) =>
      Math.max(toMm(style.size) + style.padding * 2, ...cells.map((cell, index) => this.textHeight(cell === null || cell === '' ? ' ' : cell, style, span ?? widths[index] ?? element.width) + style.padding * 2));

    const header: TableRow | null = element.showHeader ? { cells: element.headers, height: height(element.headers, element.headerStyle), kind: 'header', odd: false } : null;
    const body: TableRow[] = element.rows.map((cells, index) => ({ cells, height: height(cells, element.style), kind: 'body', odd: index % 2 === 1 }));
    for (let index = body.length; index < element.minRows; index++) {
      const cells = element.columns.map(() => '');
      body.push({ cells, height: height(cells, element.style), kind: 'body', odd: index % 2 === 1 });
    }
    if (body.length === 0) body.push({ cells: [element.emptyMessage], height: height([element.emptyMessage], element.style, element.width), kind: 'empty', odd: false });

    let total: TableRow | null = null;
    if (element.totals !== null && element.totals.some((cell) => cell !== null)) {
      const cells = [...element.totals];
      const firstSum = cells.findIndex((cell) => cell !== null);
      if (firstSum > 0) cells[0] = element.totalLabel;
      total = { cells, height: height(cells, { ...element.style, bold: true }), kind: 'total', odd: false };
    }
    return { header, body, total };
  }

  /** Spreads the rows over pages and says where the table ends. The header repeats on each page; the last row travels with the total. */
  private placeTable(element: TableElement, widths: readonly number[], rows: ReturnType<CanvasLayouter['tableRows']>, startPage: number, startY: number): { page: number; y: number } {
    let page = startPage;
    let y = startY;
    let piece: TableRow[] = [];
    let pieceY = y;

    const closePiece = () => {
      if (piece.length === 0) return;
      const pieceRows = piece;
      this.placed.push({ order: element.order, page, y: pieceY, height: pieceRows.reduce((sum, row) => sum + row.height, 0), draw: (p, yy) => this.drawRows(element, pieceRows, widths, p, yy) });
      piece = [];
    };
    const startPiece = () => {
      pieceY = y;
      if (rows.header !== null) {
        piece.push(rows.header);
        y += rows.header.height;
      }
    };
    const nextPage = () => {
      closePiece();
      page += 1;
      if (page > PDF_LIMITS.maxPages) throw new RenderLimitError('PAGES');
      y = this.continueAt;
      startPiece();
    };

    startPiece();
    rows.body.forEach((row, index) => {
      const withTotal = index === rows.body.length - 1 && rows.total !== null ? rows.total.height : 0;
      if (y + row.height + withTotal > this.limit && piece.some((candidate) => candidate.kind !== 'header')) nextPage();
      piece.push(row);
      y += row.height;
    });
    if (rows.total !== null) {
      if (y + rows.total.height > this.limit) nextPage();
      piece.push(rows.total);
      y += rows.total.height;
    }
    closePiece();
    return { page, y };
  }

  private drawRows(element: TableElement, rows: readonly TableRow[], widths: readonly number[], page: number, top: number): CanvasOp[] {
    const ops: CanvasOp[] = [];
    const firstSum = element.totals?.findIndex((cell) => cell !== null) ?? -1;
    let y = top;
    for (const row of rows) {
      const style: CanvasStyle =
        row.kind === 'header'
          ? element.headerStyle
          : row.kind === 'total'
            ? { ...element.style, bold: true, background: element.style.background ?? TOTAL_BACKGROUND }
            : row.odd && element.zebra !== null
              ? { ...element.style, background: element.zebra }
              : element.style;
      if (row.kind === 'empty') {
        ops.push(...this.box(page, element.x, y, element.width, row.height, element.style));
        ops.push(...this.textInBox(page, row.cells[0] ?? '', element.x, y, element.width, row.height, { ...element.style, italic: true, align: 'CENTER', verticalAlign: 'MIDDLE', color: EMPTY_TABLE_GREY }));
      } else if (row.kind === 'total' && firstSum > 0) {
        // The label of the total spans the columns before the first sum.
        const labelWidth = widths.slice(0, firstSum).reduce((sum, width) => sum + width, 0);
        ops.push(...this.box(page, element.x, y, labelWidth, row.height, style));
        ops.push(...this.textInBox(page, row.cells[0] ?? '', element.x, y, labelWidth, row.height, { ...style, align: 'RIGHT', verticalAlign: 'MIDDLE' }));
        let x = element.x + labelWidth;
        for (let index = firstSum; index < widths.length; index++) {
          ops.push(...this.box(page, x, y, widths[index]!, row.height, style));
          ops.push(...this.textInBox(page, row.cells[index] ?? '', x, y, widths[index]!, row.height, { ...style, align: element.columns[index]!.align, verticalAlign: 'MIDDLE' }));
          x += widths[index]!;
        }
      } else {
        let x = element.x;
        row.cells.forEach((cell, index) => {
          ops.push(...this.box(page, x, y, widths[index]!, row.height, style));
          ops.push(...this.textInBox(page, cell ?? '', x, y, widths[index]!, row.height, { ...style, align: element.columns[index]!.align, verticalAlign: 'MIDDLE' }));
          x += widths[index]!;
        });
      }
      y += row.height;
    }
    return ops;
  }

  // --- Drawing ---------------------------------------------------------------------------------------------------

  private draw(element: ResolvedCanvasElement, page: number, y: number, height: number, frame: PageFrame): CanvasOp[] {
    const { x, width, style } = element;
    switch (element.type) {
      case 'text':
        return [...this.box(page, x, y, width, height, style), ...this.textInBox(page, element.text(frame), x, y, width, height, style)];
      case 'rectangle':
        return this.box(page, x, y, width, height, style);
      case 'line':
        return element.orientation === 'HORIZONTAL'
          ? [{ kind: 'line', page, x1: x, y1: y + height / 2, x2: x + width, y2: y + height / 2, thickness: element.thickness, color: element.color, dash: element.dash }]
          : [{ kind: 'line', page, x1: x + width / 2, y1: y, x2: x + width / 2, y2: y + height, thickness: element.thickness, color: element.color, dash: element.dash }];
      case 'image':
        return [...this.box(page, x, y, width, height, style), ...(element.imageKey === null ? [] : [{ kind: 'image' as const, page, x, y, width, height, imageKey: element.imageKey, fit: element.fit }])];
      case 'signature':
        return this.signatures(element, page, y, height);
      case 'table':
        return []; // drawn in pieces (see placeTable)
    }
  }

  private box(page: number, x: number, y: number, width: number, height: number, style: CanvasStyle): CanvasOp[] {
    if (style.background === null && style.border <= 0) return [];
    return [{ kind: 'box', page, x, y, width, height, background: style.background, border: style.border, borderColor: style.borderColor, radius: Math.min(style.radius, width / 2, height / 2) }];
  }

  /** A text inside a box: wrapped to its width, aligned both ways, clipped to the box. */
  private textInBox(page: number, text: string, x: number, y: number, width: number, height: number, style: CanvasStyle): CanvasOp[] {
    if (text === '') return [];
    const advance = this.lineAdvance(style);
    const wrapped = this.wrap(text, style, width);
    const textHeight = wrapped.length * advance;
    const usable = height - style.padding * 2;
    const offset = style.verticalAlign === 'MIDDLE' ? Math.max(0, (usable - textHeight) / 2) : style.verticalAlign === 'BOTTOM' ? Math.max(0, usable - textHeight) : 0;
    const left = x + style.padding;
    const available = width - style.padding * 2;
    const lines: PlacedLine[] = wrapped.map((line, index) => {
      const measured = toMm(this.measurer.width(line.text, style));
      const spaces = line.text.split(' ').length - 1;
      const justify = style.align === 'JUSTIFY' && !line.last && spaces > 0 && measured < available;
      const wordSpacing = justify ? (available - measured) / spaces : 0;
      const lineX = style.align === 'CENTER' ? left + (available - measured) / 2 : style.align === 'RIGHT' ? left + available - measured : left;
      return { text: line.text, x: lineX, top: y + style.padding + offset + index * advance, width: justify ? available : measured, wordSpacing };
    });
    const textStyle: TextStyle = { font: style.font, size: style.size, bold: style.bold, italic: style.italic, underline: style.underline, color: style.color };
    return [{ kind: 'text', page, clip: { x, y, width, height }, lines, style: textStyle }];
  }

  /** Several signers in one box share it in columns of at least 40 mm and, when they do not fit in a row, in several rows. */
  private signatures(element: SignatureElement, page: number, y: number, height: number): CanvasOp[] {
    const signers = element.signers.length === 0 ? [null] : element.signers;
    if (signers.length === 1) return this.signature(element, page, element.x, y, element.width, height, signers[0]!, element.style);
    const columns = Math.max(1, Math.min(signers.length, Math.floor(element.width / SIGNATURE_COLUMN_MIN)));
    const rows = Math.ceil(signers.length / columns);
    const [width, rowHeight] = [element.width / columns, height / rows];
    const inner: CanvasStyle = { ...element.style, background: null, border: 0 };
    return [
      ...this.box(page, element.x, y, element.width, height, element.style),
      ...signers.flatMap((signer, index) => this.signature(element, page, element.x + (index % columns) * width, y + Math.floor(index / columns) * rowHeight, width, rowHeight, signer, inner)),
    ];
  }

  /** The signature image on top, the line, and under it the name, the label and the date. */
  private signature(element: SignatureElement, page: number, x: number, y: number, width: number, height: number, signer: ResolvedSigner | null, style: CanvasStyle): CanvasOp[] {
    const ops = this.box(page, x, y, width, height, style);
    const padding = style.padding;
    const lineHeight = toMm(style.size * 1.25);
    // Three lines are always kept under the line (name, label, date): boxes of the same height then line up.
    const lineY = y + height - 3 * lineHeight - padding - 0.5;
    const imageHeight = lineY - y - padding;
    if (signer?.imageKey != null && imageHeight > 2) ops.push({ kind: 'image', page, x: x + padding, y: y + padding, width: width - padding * 2, height: imageHeight, imageKey: signer.imageKey, fit: 'CONTAIN' });
    if (element.showLine) ops.push({ kind: 'line', page, x1: x + padding, y1: lineY, x2: x + width - padding, y2: lineY, thickness: 0.7, color: style.color, dash: 'SOLID' });
    const texts = [
      element.showName && signer?.name ? { text: signer.name, main: true } : null,
      element.label !== '' ? { text: element.label, main: false } : null,
      element.showDate && signer?.date ? { text: signer.date, main: false } : null,
    ].filter((entry): entry is { text: string; main: boolean } => entry !== null);
    texts.forEach((entry, index) => {
      ops.push(
        ...this.textInBox(page, entry.text, x, lineY + 0.5 + index * lineHeight, width, lineHeight + 0.5, {
          ...style,
          bold: entry.main || style.bold,
          padding: 0,
          background: null,
          border: 0,
          verticalAlign: 'TOP',
          lineHeight: 1,
          color: entry.main ? style.color : SIGNATURE_GREY,
        }),
      );
    });
    return ops;
  }
}
