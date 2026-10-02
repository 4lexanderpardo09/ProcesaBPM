import { PDF_LIMITS } from '@procesabpm/shared';
import type { Align, DrawCommand, ResolvedBlock, TextMeasurer } from '../resolved-document.js';
import { columnWidths } from './table-layout.js';
import { alignedX, clampLines, wrapText } from './text-wrap.js';

const LINE_FACTOR = 1.3;
const HEADING_SIZES = { 1: 18, 2: 14, 3: 12 } as const;
const CELL_PADDING = 3;
const BLACK = '#000000';

export class RenderLimitError extends Error {
  override readonly name = 'RenderLimitError';
  constructor(readonly reason: 'PAGES' | 'ROWS' | 'TIMEOUT') {
    super(`The document exceeds a limit (${reason})`);
  }
}

export interface PageSetup {
  readonly width: number;
  readonly height: number;
  readonly margins: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
}

export interface Band {
  readonly height: number;
  /** Header and footer blocks may show the page number, so they are resolved for each page. */
  readonly resolve: (page: number, pages: number) => readonly ResolvedBlock[];
}

export interface LayoutInput {
  readonly page: PageSetup;
  readonly defaultFontSize: number;
  readonly body: readonly ResolvedBlock[];
  readonly header?: Band | undefined;
  readonly footer?: Band | undefined;
  readonly measurer: TextMeasurer;
  /** `Date.now()` value after which the layout gives up (a cooperative timeout). */
  readonly deadlineAt?: number | undefined;
}

export interface LaidOutDocument {
  readonly pageCount: number;
  readonly commands: readonly DrawCommand[];
}

const lineHeight = (size: number): number => size * LINE_FACTOR;

/**
 * Lays blocks out page after page. A block that does not fit moves to the next page; text splits between lines, table rows
 * between rows (repeating the header); signature boxes, rows of fields and images are never split.
 */
class Flow {
  readonly commands: DrawCommand[] = [];
  page = 1;
  top: number;
  private readonly contentTop: number;
  private readonly contentBottom: number;
  readonly left: number;
  readonly width: number;

  constructor(
    private readonly input: LayoutInput,
    bounds?: { readonly top: number; readonly bottom: number },
  ) {
    const { page, header, footer } = input;
    this.contentTop = bounds?.top ?? page.margins.top + (header?.height ?? 0);
    this.contentBottom = bounds?.bottom ?? page.height - page.margins.bottom - (footer?.height ?? 0);
    this.left = page.margins.left;
    this.width = page.width - page.margins.left - page.margins.right;
    this.top = this.contentTop;
  }

  get measurer(): TextMeasurer {
    return this.input.measurer;
  }

  get fontSize(): number {
    return this.input.defaultFontSize;
  }

  checkDeadline(): void {
    if (this.input.deadlineAt !== undefined && Date.now() > this.input.deadlineAt) throw new RenderLimitError('TIMEOUT');
  }

  newPage(): void {
    this.page += 1;
    if (this.page > PDF_LIMITS.maxPages) throw new RenderLimitError('PAGES');
    this.top = this.contentTop;
  }

  atTop(): boolean {
    return this.top <= this.contentTop;
  }

  /** Moves to a new page unless `height` fits in what is left (a fresh page always accepts it). */
  ensure(height: number): void {
    if (this.top + height > this.contentBottom && !this.atTop()) this.newPage();
  }

  fits(height: number): boolean {
    return this.top + height <= this.contentBottom;
  }

  push(command: DrawCommand): void {
    this.commands.push(command);
  }
}

function placeLines(flow: Flow, lines: readonly string[], size: number, bold: boolean, align: Align, color: string, left: number, width: number): void {
  const height = lineHeight(size);
  for (const line of lines) {
    flow.ensure(height);
    const x = alignedX(left, width, flow.measurer.width(line, size, bold), align);
    if (line !== '') flow.push({ kind: 'text', page: flow.page, x, top: flow.top + size * 0.15, text: line, size, bold, color });
    flow.top += height;
  }
}

function placeText(flow: Flow, block: Extract<ResolvedBlock, { type: 'text' | 'heading' }>): void {
  const size = block.type === 'heading' ? HEADING_SIZES[block.level] : (block.fontSize ?? flow.fontSize);
  const bold = block.type === 'heading' ? true : (block.bold ?? false);
  const align = block.type === 'heading' ? 'LEFT' : (block.align ?? 'LEFT');
  const color = block.type === 'heading' ? BLACK : (block.color ?? BLACK);
  placeLines(flow, wrapText(block.text, flow.width, size, bold, flow.measurer), size, bold, align, color, flow.left, flow.width);
}

function placeFields(flow: Flow, block: Extract<ResolvedBlock, { type: 'fields' }>): void {
  const size = flow.fontSize;
  const gap = 12;
  const cellWidth = (flow.width - gap * (block.columns - 1)) / block.columns;
  const labelWidth = (cellWidth * block.labelWidthPercent) / 100;
  const valueWidth = cellWidth - labelWidth - 4;
  for (let start = 0; start < block.rows.length; start += block.columns) {
    flow.checkDeadline();
    const group = block.rows.slice(start, start + block.columns);
    const wrapped = group.map((row) => ({ label: wrapText(row.label, labelWidth - 4, size, true, flow.measurer), value: wrapText(row.value, valueWidth, size, false, flow.measurer) }));
    const lines = Math.max(...wrapped.map((cell) => Math.max(cell.label.length, cell.value.length)));
    const height = lines * lineHeight(size) + 3;
    flow.ensure(height);
    for (const [index, cell] of wrapped.entries()) {
      const x = flow.left + index * (cellWidth + gap);
      for (const [lineIndex, text] of cell.label.entries()) if (text !== '') flow.push({ kind: 'text', page: flow.page, x, top: flow.top + lineIndex * lineHeight(size) + size * 0.15, text, size, bold: true, color: BLACK });
      for (const [lineIndex, text] of cell.value.entries()) if (text !== '') flow.push({ kind: 'text', page: flow.page, x: x + labelWidth, top: flow.top + lineIndex * lineHeight(size) + size * 0.15, text, size, bold: false, color: BLACK });
    }
    flow.top += height;
  }
}

function placeTable(flow: Flow, block: Extract<ResolvedBlock, { type: 'table' }>): void {
  if (block.rows.length > PDF_LIMITS.maxTableRows) throw new RenderLimitError('ROWS');
  const size = flow.fontSize;
  const widths = columnWidths(block.columns.map((column) => column.width), flow.width);
  const measure = (cells: readonly string[], bold: boolean) => {
    const lines = cells.map((cell, index) => {
      const inner = widths[index]! - 2 * CELL_PADDING;
      return clampLines(wrapText(cell, inner, size, bold, flow.measurer), PDF_LIMITS.maxCellLines, inner, size, bold, flow.measurer);
    });
    return { lines, height: Math.max(...lines.map((cell) => cell.length), 1) * lineHeight(size) + 2 * CELL_PADDING };
  };
  const draw = (row: ReturnType<typeof measure>, bold: boolean): void => {
    let x = flow.left;
    for (const [index, cell] of row.lines.entries()) {
      const align = block.columns[index]?.align ?? 'LEFT';
      for (const [lineIndex, text] of cell.entries()) {
        if (text === '') continue;
        const textX = alignedX(x + CELL_PADDING, widths[index]! - 2 * CELL_PADDING, flow.measurer.width(text, size, bold), align);
        flow.push({ kind: 'text', page: flow.page, x: textX, top: flow.top + CELL_PADDING + lineIndex * lineHeight(size) + size * 0.15, text, size, bold, color: BLACK });
      }
      x += widths[index]!;
    }
    flow.push({ kind: 'rule', page: flow.page, x1: flow.left, x2: flow.left + flow.width, top: flow.top + row.height, thickness: 0.4 });
    flow.top += row.height;
  };
  const header = measure(block.headers, true);
  const place = (cells: readonly string[], bold: boolean): void => {
    flow.checkDeadline();
    const row = measure(cells, bold);
    if (!flow.fits(row.height) && !flow.atTop()) {
      flow.newPage();
      if (block.repeatHeader) draw(header, true);
    }
    draw(row, bold);
  };
  // The header never stays alone at the bottom of a page: it needs room for the first row too.
  flow.ensure(header.height + measure(block.rows[0] ?? [], false).height);
  draw(header, true);
  for (const row of block.rows) place(row, false);
  if (block.totals !== undefined) place(block.totals, true);
}

function placeSignatures(flow: Flow, block: Extract<ResolvedBlock, { type: 'signatures' }>): void {
  const size = Math.max(7, flow.fontSize - 1);
  const gap = 16;
  const slotWidth = (flow.width - gap * (block.perRow - 1)) / block.perRow;
  for (let start = 0; start < block.slots.length; start += block.perRow) {
    flow.checkDeadline();
    const group = block.slots.slice(start, start + block.perRow);
    const captions = group.map((slot) => clampLines(wrapText(slot.caption, slotWidth, size, false, flow.measurer), 3, slotWidth, size, false, flow.measurer));
    const height = block.height + Math.max(...captions.map((lines) => lines.length), 1) * lineHeight(size) + 6;
    flow.ensure(height);
    for (const [index, slot] of group.entries()) {
      const x = flow.left + index * (slotWidth + gap);
      flow.push(slot.imageKey === null ? { kind: 'box', page: flow.page, x, top: flow.top, width: slotWidth, height: block.height } : { kind: 'image', page: flow.page, imageKey: slot.imageKey, x, top: flow.top, width: slotWidth, height: block.height });
      flow.push({ kind: 'rule', page: flow.page, x1: x, x2: x + slotWidth, top: flow.top + block.height, thickness: 0.6 });
      for (const [lineIndex, text] of captions[index]!.entries()) flow.push({ kind: 'text', page: flow.page, x, top: flow.top + block.height + 3 + lineIndex * lineHeight(size), text, size, bold: false, color: BLACK });
    }
    flow.top += height;
  }
}

function placeBlock(flow: Flow, block: ResolvedBlock): void {
  flow.checkDeadline();
  if (block.type === 'pageBreak') {
    if (flow.top > 0) flow.newPage();
    return;
  }
  flow.top += block.spaceBefore ?? 0;
  switch (block.type) {
    case 'text':
    case 'heading':
      placeText(flow, block);
      break;
    case 'fields':
      placeFields(flow, block);
      break;
    case 'table':
      placeTable(flow, block);
      break;
    case 'signatures':
      placeSignatures(flow, block);
      break;
    case 'image': {
      flow.ensure(block.height);
      const x = alignedX(flow.left, flow.width, block.width, block.align ?? 'LEFT');
      flow.push({ kind: 'image', page: flow.page, imageKey: block.imageKey, x, top: flow.top, width: block.width, height: block.height });
      flow.top += block.height;
      break;
    }
    case 'line':
      flow.ensure(8);
      flow.push({ kind: 'rule', page: flow.page, x1: flow.left, x2: flow.left + flow.width, top: flow.top + 4, thickness: 0.6 });
      flow.top += 8;
      break;
    case 'spacer':
      flow.top += block.height;
      break;
  }
  flow.top += block.spaceAfter ?? 0;
}

/** Header and footer are laid out after the body is paginated, so `{{pages}}` is known. What does not fit the band is dropped. */
function layoutBand(input: LayoutInput, band: Band, kind: 'header' | 'footer', page: number, pages: number): DrawCommand[] {
  const top = kind === 'header' ? input.page.margins.top : input.page.height - input.page.margins.bottom - band.height;
  const flow = new Flow({ ...input, header: undefined, footer: undefined, body: [] }, { top, bottom: top + band.height });
  for (const block of band.resolve(page, pages)) placeBlock(flow, block);
  return flow.commands.filter((command) => command.page === 1).map((command) => ({ ...command, page }));
}

export function layoutDocument(input: LayoutInput): LaidOutDocument {
  const flow = new Flow(input);
  for (const block of input.body) placeBlock(flow, block);
  const pageCount = flow.page;
  const commands = [...flow.commands];
  for (let page = 1; page <= pageCount; page += 1) {
    if (input.header !== undefined) commands.push(...layoutBand(input, input.header, 'header', page, pageCount));
    if (input.footer !== undefined) commands.push(...layoutBand(input, input.footer, 'footer', page, pageCount));
  }
  return { pageCount, commands };
}
