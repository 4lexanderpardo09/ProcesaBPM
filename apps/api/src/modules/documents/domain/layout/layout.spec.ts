import { describe, expect, it } from 'vitest';
import type { DrawCommand, ResolvedBlock, TextMeasurer } from '../resolved-document.js';
import { layoutDocument, RenderLimitError, type LayoutInput } from './flow-layout.js';
import { columnWidths } from './table-layout.js';
import { alignedX, clampLines, wrapText } from './text-wrap.js';

/** Every character is half the font size wide (bold a bit wider): makes the arithmetic of the tests easy to follow. */
const measurer: TextMeasurer = { width: (text, size, bold) => text.length * size * (bold ? 0.55 : 0.5) };

describe('wrapText', () => {
  it('breaks at spaces and keeps newlines', () => {
    expect(wrapText('uno dos tres', 30, 10, false, measurer)).toEqual(['uno', 'dos', 'tres']);
    expect(wrapText('uno dos tres', 100, 10, false, measurer)).toEqual(['uno dos tres']);
    expect(wrapText('a\n\nb', 100, 10, false, measurer)).toEqual(['a', '', 'b']);
  });
  it('splits a word wider than the line', () => {
    expect(wrapText('abcdefghij', 25, 10, false, measurer)).toEqual(['abcde', 'fghij']);
  });
  it('measures with the accents composed: ñ and á are one character', () => {
    expect(wrapText('señor árbol', 30, 10, false, measurer)).toEqual(['señor', 'árbol']);
  });
  it('clamps to a number of lines ending in an ellipsis', () => {
    expect(clampLines(['a', 'b', 'c'], 2, 100, 10, false, measurer)).toEqual(['a', 'b…']);
    expect(clampLines(['a'], 2, 100, 10, false, measurer)).toEqual(['a']);
  });
  it('aligns left, centre and right', () => {
    expect([alignedX(10, 100, 40, 'LEFT'), alignedX(10, 100, 40, 'CENTER'), alignedX(10, 100, 40, 'RIGHT')]).toEqual([10, 40, 70]);
  });
});

describe('columnWidths', () => {
  it('shares what the fixed columns leave by fr', () => {
    expect(columnWidths([{ pt: 100 }, { fr: 1 }, { fr: 3 }], 500)).toEqual([100, 100, 300]);
  });
  it('shrinks everything in proportion when the columns are too wide, and gives fractions at least 20 pt', () => {
    expect(columnWidths([{ pt: 300 }, { pt: 300 }], 300)).toEqual([150, 150]);
    expect(columnWidths([{ pt: 290 }, { fr: 1 }], 300)[1]).toBeGreaterThanOrEqual(20 * (300 / 310) - 0.001);
  });
});

const input = (body: ResolvedBlock[], extra: Partial<LayoutInput> = {}): LayoutInput => ({
  page: { width: 200, height: 200, margins: { top: 20, right: 20, bottom: 20, left: 20 } },
  defaultFontSize: 10,
  body,
  measurer,
  ...extra,
});
const texts = (commands: readonly DrawCommand[], page?: number) => commands.flatMap((command) => (command.kind === 'text' && (page === undefined || command.page === page) ? [command.text] : []));

describe('layoutDocument', () => {
  it('puts text at the top of the content box and flows it onto the next page when it runs out of room', () => {
    const lines = Array.from({ length: 20 }, (_v, index) => `L${index}`).join('\n');
    const laid = layoutDocument(input([{ type: 'text', text: lines }]));
    expect(laid.pageCount).toBeGreaterThan(1);
    expect(texts(laid.commands, 1)[0]).toBe('L0');
    expect(texts(laid.commands, 2)[0]).not.toBe('L0');
    expect(texts(laid.commands)).toHaveLength(20);
  });

  it('never draws below the bottom margin', () => {
    const laid = layoutDocument(input([{ type: 'text', text: Array.from({ length: 40 }, () => 'x').join('\n') }]));
    for (const command of laid.commands) if (command.kind === 'text') expect(command.top + command.size).toBeLessThanOrEqual(200 - 20 + 1);
  });

  it('headings are bold and larger; page breaks start a new page; spacing moves the cursor', () => {
    const laid = layoutDocument(input([{ type: 'heading', text: 'Título', level: 1 }, { type: 'pageBreak' }, { type: 'text', text: 'Segunda', spaceBefore: 10 }]));
    expect(laid.pageCount).toBe(2);
    const heading = laid.commands.find((command) => command.kind === 'text' && command.text === 'Título');
    expect(heading).toMatchObject({ bold: true, size: 18, page: 1 });
    const second = laid.commands.find((command) => command.kind === 'text' && command.text === 'Segunda');
    expect(second).toMatchObject({ page: 2 });
    expect((second as { top: number }).top).toBeGreaterThan(30);
  });

  it('keeps a signature row together: it moves whole to the next page', () => {
    const laid = layoutDocument(input([{ type: 'spacer', height: 90 }, { type: 'signatures', perRow: 1, height: 60, slots: [{ caption: 'Firmado por Ana', imageKey: null }] }]));
    const box = laid.commands.find((command) => command.kind === 'box');
    expect(box).toMatchObject({ page: 2 });
    expect(texts(laid.commands, 2)).toEqual(['Firmado por Ana']);
  });

  it('prints signature images where the slot has one', () => {
    const laid = layoutDocument(input([{ type: 'signatures', perRow: 2, height: 30, slots: [{ caption: 'A', imageKey: 'sig-a' }, { caption: 'B', imageKey: null }] }]));
    expect(laid.commands.filter((command) => command.kind === 'image')).toHaveLength(1);
    expect(laid.commands.filter((command) => command.kind === 'box')).toHaveLength(1);
  });

  it('splits a table between rows and repeats the header on the new page', () => {
    const rows = Array.from({ length: 30 }, (_v, index) => [`fila ${index}`]);
    const laid = layoutDocument(input([{ type: 'table', headers: ['Cabecera'], columns: [{ width: { fr: 1 } }], rows, repeatHeader: true }]));
    expect(laid.pageCount).toBeGreaterThan(1);
    expect(texts(laid.commands, 2)[0]).toBe('Cabecera');
    expect(texts(laid.commands).filter((text) => text.startsWith('fila'))).toHaveLength(30);
  });

  it('does not repeat the header when asked not to, and draws the totals row last', () => {
    const rows = Array.from({ length: 30 }, (_v, index) => [`fila ${index}`]);
    const laid = layoutDocument(input([{ type: 'table', headers: ['Cabecera'], columns: [{ width: { fr: 1 } }], rows, repeatHeader: false, totals: ['TOTAL'] }]));
    expect(texts(laid.commands, 2)[0]).not.toBe('Cabecera');
    expect(texts(laid.commands).at(-1)).toBe('TOTAL');
  });

  it('wraps long cells and caps them at 20 lines', () => {
    const laid = layoutDocument(input([{ type: 'table', headers: ['H'], columns: [{ width: { fr: 1 } }], rows: [['palabra '.repeat(400)]], repeatHeader: true }], { page: { width: 200, height: 1200, margins: { top: 20, right: 20, bottom: 20, left: 20 } } }));
    expect(texts(laid.commands).filter((text) => text.startsWith('palabra')).length).toBeLessThanOrEqual(20);
    expect(texts(laid.commands).some((text) => text.endsWith('…'))).toBe(true);
  });

  it('lays out fields in columns, label then value, without splitting a row', () => {
    const laid = layoutDocument(input([{ type: 'fields', columns: 2, labelWidthPercent: 40, rows: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] }]));
    const at = (text: string) => laid.commands.find((command) => command.kind === 'text' && command.text === text) as { x: number; top: number };
    const [a, one, b, two] = [at('A'), at('1'), at('B'), at('2')] as [ReturnType<typeof at>, ReturnType<typeof at>, ReturnType<typeof at>, ReturnType<typeof at>];
    expect(one.x).toBeGreaterThan(a.x);
    expect(b.x).toBeGreaterThan(one.x);
    expect(a.top).toBe(b.top);
    expect(two.x).toBeGreaterThan(b.x);
  });

  it('draws the header and footer on every page with the page numbers known', () => {
    const lines = Array.from({ length: 30 }, (_v, index) => `L${index}`).join('\n');
    const footer = { height: 14, resolve: (page: number, pages: number): ResolvedBlock[] => [{ type: 'text', text: `Página ${page} de ${pages}` }] };
    const header = { height: 14, resolve: (): ResolvedBlock[] => [{ type: 'text', text: 'Encabezado' }] };
    const laid = layoutDocument(input([{ type: 'text', text: lines }], { footer, header }));
    for (let page = 1; page <= laid.pageCount; page += 1) {
      expect(texts(laid.commands, page)).toContain(`Página ${page} de ${laid.pageCount}`);
      expect(texts(laid.commands, page)).toContain('Encabezado');
    }
  });

  it('stops at the limits: too many pages, too many table rows, and the deadline', () => {
    expect(() => layoutDocument(input(Array.from({ length: 201 }, () => ({ type: 'pageBreak' }) as ResolvedBlock).flatMap((b) => [{ type: 'text', text: 'x' } as ResolvedBlock, b])))).toThrow(RenderLimitError);
    const rows = Array.from({ length: 2001 }, () => ['x']);
    expect(() => layoutDocument(input([{ type: 'table', headers: ['H'], columns: [{ width: { fr: 1 } }], rows, repeatHeader: true }]))).toThrow(/ROWS/);
    expect(() => layoutDocument(input([{ type: 'text', text: 'x' }], { deadlineAt: Date.now() - 1 }))).toThrow(/TIMEOUT/);
  });
});
