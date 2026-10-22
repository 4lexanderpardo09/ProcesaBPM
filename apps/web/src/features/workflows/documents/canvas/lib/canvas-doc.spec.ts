import { type CanvasElement, emptyCanvasDesign, type FieldDocument, type PdfCanvasDesign } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { addSheet, alignElements, createElement, duplicateElements, elementOfPath, moveLayer, removeSheet, snap, swapSheets } from './canvas-doc';

const sheet = { width: 200, height: 280 };
const design = (elements: CanvasElement[], sheets = 1): PdfCanvasDesign => ({ ...emptyCanvasDesign(), sheets: Array.from({ length: sheets }, () => ({ name: '', condition: '' })), elements });
const text = (id: string, x: number, y: number, extra: Partial<CanvasElement> = {}): CanvasElement => ({ ...createElement('text', { x: 0, y: 0 }, 0, sheet, { name: id }), id, x, y, ...extra }) as CanvasElement;

describe('snap', () => {
  const others = [{ x: 50, y: 50, width: 40, height: 10 }];

  it('pulls an edge or a centre onto the nearest line of another box, and says where', () => {
    expect(snap({ x: 51.5, y: 100, width: 20, height: 10 }, others, sheet, 2, null)).toEqual({ dx: -1.5, dy: 0, guides: [{ axis: 'x', at: 50 }] });
    // Its centre (61 + 10) meets the other centre (70).
    expect(snap({ x: 59.2, y: 100, width: 20, height: 10 }, others, sheet, 2, null)).toEqual({ dx: 0.8, dy: 0, guides: [{ axis: 'x', at: 70 }] });
  });

  it('snaps to the sheet edges and centre, and falls back to the grid', () => {
    expect(snap({ x: 1, y: 135, width: 10, height: 10 }, [], sheet, 2, null).guides).toEqual([{ axis: 'x', at: 0 }, { axis: 'y', at: 140 }]);
    expect(snap({ x: 23.4, y: 31.2, width: 10, height: 10 }, [], sheet, 0.5, 5)).toEqual({ dx: 1.6, dy: -1.2, guides: [] });
  });
});

describe('createElement', () => {
  const table: FieldDocument = { id: 'f', stepId: 's', code: 'ITEMS', label: 'Ítems', type: 'TABLE', capture: 'CREATION', isRequired: false, isReadOnly: false, sortOrder: 0, config: { columns: [{ code: 'QTY', label: 'Cantidad' }, { code: 'NAME', label: 'Nombre' }] }, dataSource: null };

  it('centres a new element on the point, inside the sheet', () => {
    expect(createElement('text', { x: 100, y: 100 }, 0, sheet, { name: 'Texto' })).toMatchObject({ x: 70, y: 96, width: 60, height: 8 });
    expect(createElement('text', { x: 199, y: 1 }, 2, sheet, { name: 'Texto' })).toMatchObject({ x: 140, y: 0, sheet: 2 });
  });

  it('a table lists every column of its field', () => {
    const element = createElement('table', { x: 100, y: 100 }, 0, sheet, { name: 'Tabla', tableField: table });
    expect(element).toMatchObject({ type: 'table', fieldCode: 'ITEMS', columns: [{ header: 'Cantidad', value: '{{row.QTY}}' }, { header: 'Nombre', value: '{{row.NAME}}' }] });
  });
});

describe('layers, copies and alignment', () => {
  it('moves a layer up, down, to the top and to the bottom', () => {
    const base = design([text('a', 0, 0), text('b', 0, 0), text('c', 0, 0)]);
    const ids = (next: PdfCanvasDesign) => next.elements.map((element) => element.id);
    expect(ids(moveLayer(base, 'a', 1))).toEqual(['b', 'a', 'c']);
    expect(ids(moveLayer(base, 'c', -1))).toEqual(['a', 'c', 'b']);
    expect(ids(moveLayer(base, 'a', 'top'))).toEqual(['b', 'c', 'a']);
    expect(ids(moveLayer(base, 'c', 'bottom'))).toEqual(['c', 'a', 'b']);
  });

  it('copies on top, shifted, with new ids and unlocked', () => {
    const { design: next, copies } = duplicateElements(design([text('a', 10, 10, { locked: true })]), new Set(['a']));
    expect(copies).toHaveLength(1);
    expect(next.elements[1]).toMatchObject({ id: copies[0], x: 15, y: 15, locked: false });
  });

  it('aligns the unlocked ones with the box around them', () => {
    const base = design([text('a', 10, 10), text('b', 40, 30), text('c', 90, 50, { locked: true })]);
    const all = new Set(['a', 'b', 'c']);
    expect(alignElements(base, all, 'right').elements.map((element) => element.x)).toEqual([40, 40, 90]);
    expect(alignElements(base, all, 'top').elements.map((element) => element.y)).toEqual([10, 10, 50]);
  });
});

describe('sheets', () => {
  it('adds up to ten, removes one with its elements but keeps the repeated ones, and swaps two', () => {
    expect(addSheet(design([], 10)).sheets).toHaveLength(10);
    const base = design([text('one', 0, 0, { sheet: 0 }), text('two', 0, 0, { sheet: 1 }), text('three', 0, 0, { sheet: 2 }), text('header', 0, 0, { sheet: 1, repeat: true })], 3);
    const removed = removeSheet(base, 1);
    expect(removed.sheets).toHaveLength(2);
    expect(removed.elements.map((element) => [element.id, element.sheet])).toEqual([
      ['one', 0],
      ['three', 1],
      ['header', 0],
    ]);
    expect(swapSheets(base, 0, 2).elements.map((element) => element.sheet)).toEqual([2, 1, 0, 1]);
  });

  it('points a validation path at its element', () => {
    const base = design([text('a', 0, 0), text('b', 0, 0)]);
    expect(elementOfPath(base, 'elements[1].content')).toBe('b');
    expect(elementOfPath(base, 'calculations[0].formula')).toBeUndefined();
  });
});
