import { type CanvasStyle, defaultCanvasStyle } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import type { CanvasContent, CanvasMeasurer, CanvasOp, ResolvedCanvasElement } from '../canvas-document.js';
import { layoutCanvas } from './canvas-layout.js';
import { RenderLimitError } from './flow-layout.js';

/** Every character is half the font size wide: lines are easy to predict. */
const measurer: CanvasMeasurer = { width: (text, style) => text.length * style.size * 0.5 };
const style = (extra: Partial<CanvasStyle> = {}): CanvasStyle => ({ ...defaultCanvasStyle(), padding: 0, ...extra });
const page = { width: 200, height: 100, marginBottom: 10 };
/** One row of a 10 pt table: a line of 1.2 × 10 pt (4.23 mm), no padding. */
const ROW = (10 * 1.2 * 25.4) / 72;
const round = (value: number) => Math.round(value * 10) / 10;

let order = 0;
const base = (id: string, y: number, extra: Partial<ResolvedCanvasElement> = {}) => ({ id, order: order++, x: 10, y, width: 100, height: 5, repeat: false, sheet: 0, style: style(), ...extra });
const text = (id: string, y: number, content: string, extra: Partial<ResolvedCanvasElement> = {}): ResolvedCanvasElement => ({ ...base(id, y, extra), type: 'text', text: () => content, grow: false, ...extra }) as ResolvedCanvasElement;
const table = (id: string, y: number, rows: number, extra: Partial<Extract<ResolvedCanvasElement, { type: 'table' }>> = {}): ResolvedCanvasElement => ({
  ...base(id, y, { height: 10 }),
  type: 'table',
  showHeader: true,
  headers: ['A', 'B'],
  headerStyle: style({ bold: true }),
  columns: [
    { align: 'LEFT', weight: 1 },
    { align: 'RIGHT', weight: 1 },
  ],
  rows: Array.from({ length: rows }, (_, index) => [`r${index}`, String(index)]),
  totals: null,
  totalLabel: 'Total',
  zebra: null,
  minRows: 0,
  emptyMessage: 'Sin filas',
  ...extra,
});
const content = (elements: ResolvedCanvasElement[], extra: Partial<CanvasContent> = {}): CanvasContent => ({ page, sheets: [0], elements, ...extra });

type TextOp = Extract<CanvasOp, { kind: 'text' }>;
const texts = (ops: readonly CanvasOp[]) => ops.filter((op): op is TextOp => op.kind === 'text');
/** Where each text starting with `prefix` was drawn: page and the top of its first line, rounded. */
const where = (ops: readonly CanvasOp[], text: string) => texts(ops).filter((op) => op.lines[0]?.text === text).map((op) => ({ page: op.page, top: Math.round(op.lines[0]!.top * 10) / 10 }));

describe('layoutCanvas', () => {
  it('draws each element where it was put', () => {
    const laid = layoutCanvas(content([text('a', 20, 'Hola'), text('b', 20, 'Al lado', { x: 120 } as never)]), measurer);
    expect(laid.pageCount).toBe(1);
    expect(where(laid.ops, 'Hola')).toEqual([{ page: 1, top: 20 }]);
    expect(texts(laid.ops).find((op) => op.lines[0]?.text === 'Al lado')?.lines[0]?.x).toBe(120);
  });

  it('a table taller than its box pushes down what is below it, never what is beside it', () => {
    const laid = layoutCanvas(content([table('t', 20, 5), text('below', 35, 'Debajo'), text('beside', 25, 'Al lado', { x: 150 } as never)]), measurer);
    const grown = 6 * ROW - 10;
    expect(where(laid.ops, 'Debajo')).toEqual([{ page: 1, top: round(35 + grown) }]);
    expect(where(laid.ops, 'Al lado')).toEqual([{ page: 1, top: 25 }]);
  });

  it('a table that does not fit goes on the next page with its header, and what is below follows its end', () => {
    const laid = layoutCanvas(content([table('t', 20, 30), text('below', 35, 'Debajo')]), measurer);
    expect(laid.pageCount).toBe(2);
    // The limit is 90 mm: under the header, 15 rows fit on the first page (20 + 16 × 4.23 ≤ 90).
    expect(where(laid.ops, 'A')).toEqual([
      { page: 1, top: 20 },
      { page: 2, top: 10 },
    ]);
    expect(where(laid.ops, 'r14')).toEqual([{ page: 1, top: round(20 + 15 * ROW) }]);
    expect(where(laid.ops, 'r15')).toEqual([{ page: 2, top: round(10 + ROW) }]);
    // What was 5 mm under the table's box stays 5 mm under its real end.
    const end = 10 + ROW + 15 * ROW;
    expect(where(laid.ops, 'Debajo')).toEqual([{ page: 2, top: round(end + 5) }]);
  });

  it('repeats the header and footer elements on every page and keeps their room', () => {
    const laid = layoutCanvas(content([text('head', 2, 'Encabezado', { repeat: true, height: 8 }), text('foot', 92, 'Pie', { repeat: true }), table('t', 20, 40)]), measurer);
    expect(laid.pageCount).toBe(3);
    expect(where(laid.ops, 'Encabezado').map((entry) => entry.page)).toEqual([1, 2, 3]);
    expect(where(laid.ops, 'Pie').map((entry) => entry.page)).toEqual([1, 2, 3]);
    // Content continues under the header (2 + 8 + 3 mm) and stops above the footer (92 - 2 mm).
    expect(where(laid.ops, 'A').map((entry) => entry.top)).toEqual([20, 13, 13]);
    const rowTops = texts(laid.ops).filter((op) => /^r\d+$/.test(op.lines[0]?.text ?? '')).map((op) => op.lines[0]!.top + ROW);
    expect(Math.max(...rowTops)).toBeLessThanOrEqual(90 + 1e-6);
  });

  it('a title glued on top of a table that jumps goes with it', () => {
    const laid = layoutCanvas(content([text('title', 77, 'Detalle'), table('t', 82, 3)]), measurer);
    expect(where(laid.ops, 'Detalle')).toEqual([{ page: 2, top: 10 }]);
    expect(where(laid.ops, 'A')).toEqual([{ page: 2, top: 15 }]);
  });

  it('a text that grows makes its box taller and pushes what is below', () => {
    const long = 'palabra '.repeat(40).trim();
    const laid = layoutCanvas(content([text('long', 20, long, { grow: true, width: 50 } as never), text('below', 30, 'Debajo')]), measurer);
    const lines = texts(laid.ops).find((op) => op.lines[0]?.text.startsWith('palabra'))!.lines.length;
    const lineHeight = (10 * 1.2 * 25.4) / 72;
    expect(where(laid.ops, 'Debajo')[0]!.top).toBeCloseTo(30 + lines * lineHeight - 5, 1);
  });

  it('starts each sheet on a new page and prints only the sheets asked for', () => {
    const laid = layoutCanvas(content([text('one', 20, 'Uno'), text('two', 20, 'Dos', { sheet: 1 }), text('three', 20, 'Tres', { sheet: 2 })], { sheets: [0, 2] }), measurer);
    expect(laid.pageCount).toBe(2);
    expect(where(laid.ops, 'Uno')).toEqual([{ page: 1, top: 20 }]);
    expect(where(laid.ops, 'Dos')).toEqual([]);
    expect(where(laid.ops, 'Tres')).toEqual([{ page: 2, top: 20 }]);
  });

  it('gives page numbers to the texts once the pages are known', () => {
    const element: ResolvedCanvasElement = { ...base('n', 92), type: 'text', grow: false, repeat: true, text: (frame) => (frame === undefined ? '' : `${frame.page}/${frame.pages}`) };
    const laid = layoutCanvas(content([element, table('t', 20, 40)]), measurer);
    expect(texts(laid.ops).filter((op) => op.lines[0]?.text.includes('/')).map((op) => op.lines[0]!.text)).toEqual(['1/3', '2/3', '3/3']);
  });

  it('fills a table up to its least rows, says when it is empty, and adds the total under the label', () => {
    const minimum = layoutCanvas(content([table('t', 20, 1, { minRows: 3 })]), measurer);
    expect(texts(minimum.ops).filter((op) => op.lines[0]?.text === 'r0')).toHaveLength(1);
    const boxes = minimum.ops.filter((op) => op.kind === 'box');
    expect(boxes).toHaveLength(0); // no background nor border: nothing to fill

    const empty = layoutCanvas(content([table('t', 20, 0)]), measurer);
    expect(where(empty.ops, 'Sin filas')).toHaveLength(1);

    const totals = layoutCanvas(content([table('t', 20, 2, { totals: [null, '1'] })]), measurer);
    const total = texts(totals.ops).filter((op) => ['Total', '1'].includes(op.lines[0]?.text ?? '') && op.style.bold);
    expect(total.map((op) => op.lines[0]!.text)).toEqual(['Total', '1']);
  });

  it('justifies every line of a paragraph but the last', () => {
    const laid = layoutCanvas(content([text('j', 20, 'uno dos tres cuatro cinco seis', { width: 40, style: style({ align: 'JUSTIFY' }) } as never)]), measurer);
    const lines = texts(laid.ops)[0]!.lines;
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(0, -1).every((line) => line.wordSpacing > 0)).toBe(true);
    expect(lines.at(-1)!.wordSpacing).toBe(0);
  });

  it('puts several signers of one box side by side', () => {
    const element: ResolvedCanvasElement = {
      ...base('s', 20, { width: 120, height: 30 }),
      type: 'signature',
      signers: [
        { name: 'Ana', date: '01/10/2026 10:00', imageKey: 'sig:a' },
        { name: 'Luis', date: null, imageKey: null },
      ],
      label: 'Aprobó',
      showName: true,
      showDate: true,
      showLine: true,
    };
    const laid = layoutCanvas(content([element]), measurer);
    expect(laid.ops.filter((op) => op.kind === 'image')).toEqual([expect.objectContaining({ imageKey: 'sig:a', x: 10 })]);
    expect(texts(laid.ops).map((op) => op.lines[0]!.text)).toEqual(['Ana', 'Aprobó', '01/10/2026 10:00', 'Luis', 'Aprobó']);
    expect(laid.ops.filter((op) => op.kind === 'line')).toHaveLength(2);
  });

  it('stops a document that would have too many pages', () => {
    expect(() => layoutCanvas(content([table('t', 20, 2001)]), measurer)).toThrow(RenderLimitError);
  });
});
