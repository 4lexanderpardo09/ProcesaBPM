import { type CanvasElement, type CanvasElementType, type CanvasStyle, canvasSheetSize, defaultCanvasStyle, type FieldDocument, type PdfCanvasDesign } from '@procesabpm/shared';
import { tableColumnsOf } from '../../lib/data-choices';

/** Screen pixels per millimetre at zoom 1 (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
/** Screen pixels per typographic point at zoom 1. */
export const PX_PER_PT = 96 / 72;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A line the moving box snapped to: vertical (`x`) or horizontal (`y`), at a millimetre position. */
export interface Guide {
  readonly axis: 'x' | 'y';
  readonly at: number;
}

export const sheetSizeOf = (design: PdfCanvasDesign) => canvasSheetSize(design.page);

/** Millimetres with one decimal: enough on paper, and the stored design stays readable. */
export const roundMm = (value: number) => Math.round(value * 10) / 10;

export const boxOf = (element: Box): Box => ({ x: element.x, y: element.y, width: element.width, height: element.height });

/** The box around all of them. */
export function boundsOf(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Pulls a moving box onto the edges and centres of the other boxes and of the sheet when it is within `tolerance`
 * millimetres, or else onto the grid. Returns how much to shift it and the guides to draw.
 */
export function snap(moving: Box, others: readonly Box[], sheet: { width: number; height: number }, tolerance: number, grid: number | null): { dx: number; dy: number; guides: Guide[] } {
  const targets = [...others, { x: 0, y: 0, width: sheet.width, height: sheet.height }];
  const axis = (start: number, size: number, of: (box: Box) => [number, number]) => {
    const own = [start, start + size / 2, start + size];
    let best: { delta: number; at: number } | undefined;
    for (const box of targets) {
      const [from, length] = of(box);
      for (const line of [from, from + length / 2, from + length]) {
        for (const point of own) {
          const delta = line - point;
          if (Math.abs(delta) <= tolerance && (best === undefined || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: line };
        }
      }
    }
    if (best !== undefined) return { delta: best.delta, guide: best.at };
    if (grid !== null && grid > 0) return { delta: Math.round(start / grid) * grid - start, guide: undefined };
    return { delta: 0, guide: undefined };
  };
  const x = axis(moving.x, moving.width, (box) => [box.x, box.width]);
  const y = axis(moving.y, moving.height, (box) => [box.y, box.height]);
  const exact = (value: number) => Math.round(value * 1000) / 1000;
  return {
    dx: exact(x.delta),
    dy: exact(y.delta),
    guides: [...(x.guide === undefined ? [] : [{ axis: 'x' as const, at: x.guide }]), ...(y.guide === undefined ? [] : [{ axis: 'y' as const, at: y.guide }])],
  };
}

let sequence = 0;
/** An id unique within the design; the time part keeps ids apart between sessions. */
export const newElementId = () => `e${Date.now().toString(36)}${(sequence++).toString(36)}`;

const SIZES: Readonly<Record<CanvasElementType, readonly [number, number]>> = {
  text: [60, 8],
  table: [180, 20],
  image: [40, 20],
  line: [80, 2],
  rectangle: [60, 30],
  signature: [70, 25],
};

/** The header of a new table: dark with white bold letters, like most printed forms. */
export const tableHeaderStyle = (): CanvasStyle => ({ ...defaultCanvasStyle(), size: 9, bold: true, color: '#FFFFFF', background: '#1F2937', border: 0.5, padding: 1.2, verticalAlign: 'MIDDLE' });

/**
 * A new element of a sensible size and style, centred on the point (clamped to the sheet). A table takes the first
 * table field and all its columns; a text made from a field shows its label and value.
 */
export function createElement(type: CanvasElementType, centre: { x: number; y: number }, sheet: number, sheetSize: { width: number; height: number }, options: { readonly tableField?: FieldDocument | undefined; readonly name: string; readonly content?: string }): CanvasElement {
  const [width, height] = SIZES[type];
  const x = roundMm(Math.max(0, Math.min(sheetSize.width - width, centre.x - width / 2)));
  const y = roundMm(Math.max(0, Math.min(sheetSize.height - height, centre.y - height / 2)));
  const base = { id: newElementId(), name: options.name, x, y, width, height, repeat: false, locked: false, sheet, condition: '', style: defaultCanvasStyle() };
  switch (type) {
    case 'text':
      return { ...base, type, content: options.content ?? '', grow: false };
    case 'table': {
      const field = options.tableField;
      const columns = field === undefined ? [] : tableColumnsOf(field);
      return {
        ...base,
        type,
        fieldCode: field?.code ?? '',
        columns: (columns.length === 0 ? [{ code: '', label: '' }] : columns).map((column) => ({ header: column.label, value: column.code === '' ? '' : `{{row.${column.code}}}`, align: 'LEFT' as const, weight: 1, sum: false })),
        showHeader: true,
        headerStyle: tableHeaderStyle(),
        zebra: null,
        showTotals: false,
        totalLabel: 'Total',
        minRows: 0,
        emptyMessage: 'Sin registros',
        style: { ...defaultCanvasStyle(), size: 9, border: 0.3, borderColor: '#9CA3AF', padding: 1.2, verticalAlign: 'MIDDLE' },
      };
    }
    case 'image':
      return { ...base, type, source: 'TENANT_LOGO', fit: 'CONTAIN' };
    case 'line':
      return { ...base, type, orientation: 'HORIZONTAL', thickness: 1, color: '#111827', dash: 'SOLID' };
    case 'rectangle':
      return { ...base, type, style: { ...defaultCanvasStyle(), border: 1 } };
    case 'signature':
      return { ...base, type, source: 'BLANK', stepName: null, signers: 'LAST', position: 1, label: '', showName: true, showDate: true, showLine: true, style: { ...defaultCanvasStyle(), size: 9, align: 'CENTER' } };
  }
}

/** Whether an element shows on a sheet of the editor: the repeated ones show on every sheet. */
export const isOnSheet = (element: CanvasElement, sheet: number) => element.repeat || element.sheet === sheet;

export function updateElements(design: PdfCanvasDesign, ids: ReadonlySet<string>, change: (element: CanvasElement) => CanvasElement): PdfCanvasDesign {
  return { ...design, elements: design.elements.map((element) => (ids.has(element.id) ? change(element) : element)) };
}

export function removeElements(design: PdfCanvasDesign, ids: ReadonlySet<string>): PdfCanvasDesign {
  return { ...design, elements: design.elements.filter((element) => !ids.has(element.id)) };
}

/** Copies placed a little lower and to the right, on top of everything, with new ids. */
export function duplicateElements(design: PdfCanvasDesign, ids: ReadonlySet<string>): { design: PdfCanvasDesign; copies: string[] } {
  const copies = design.elements.filter((element) => ids.has(element.id)).map((element) => ({ ...element, id: newElementId(), x: roundMm(element.x + 5), y: roundMm(element.y + 5), locked: false }));
  return { design: { ...design, elements: [...design.elements, ...copies] }, copies: copies.map((copy) => copy.id) };
}

/** One layer up (`1`, drawn later), down (`-1`), to the top (`'top'`) or to the bottom (`'bottom'`). */
export function moveLayer(design: PdfCanvasDesign, id: string, to: 1 | -1 | 'top' | 'bottom'): PdfCanvasDesign {
  const index = design.elements.findIndex((element) => element.id === id);
  if (index === -1) return design;
  const elements = [...design.elements];
  const [element] = elements.splice(index, 1);
  const target = to === 'top' ? elements.length : to === 'bottom' ? 0 : Math.max(0, Math.min(elements.length, index + to));
  elements.splice(target, 0, element!);
  return { ...design, elements };
}

export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** Lines the selected elements up with the box around them. */
export function alignElements(design: PdfCanvasDesign, ids: ReadonlySet<string>, alignment: Alignment): PdfCanvasDesign {
  const chosen = design.elements.filter((element) => ids.has(element.id) && !element.locked);
  if (chosen.length < 2) return design;
  const bounds = boundsOf(chosen);
  return updateElements(design, new Set(chosen.map((element) => element.id)), (element) => {
    switch (alignment) {
      case 'left':
        return { ...element, x: bounds.x };
      case 'centerX':
        return { ...element, x: roundMm(bounds.x + (bounds.width - element.width) / 2) };
      case 'right':
        return { ...element, x: roundMm(bounds.x + bounds.width - element.width) };
      case 'top':
        return { ...element, y: bounds.y };
      case 'centerY':
        return { ...element, y: roundMm(bounds.y + (bounds.height - element.height) / 2) };
      case 'bottom':
        return { ...element, y: roundMm(bounds.y + bounds.height - element.height) };
    }
  });
}

export const MAX_SHEETS = 10;

export function addSheet(design: PdfCanvasDesign): PdfCanvasDesign {
  return design.sheets.length >= MAX_SHEETS ? design : { ...design, sheets: [...design.sheets, { name: '', condition: '' }] };
}

/** Takes out sheet `index` with its elements (the repeated ones stay); the elements of later sheets move up one place. */
export function removeSheet(design: PdfCanvasDesign, index: number): PdfCanvasDesign {
  if (design.sheets.length <= 1) return design;
  return {
    ...design,
    sheets: design.sheets.filter((_, position) => position !== index),
    elements: design.elements
      .filter((element) => element.repeat || element.sheet !== index)
      .map((element) => (element.sheet > index ? { ...element, sheet: element.sheet - 1 } : element.sheet === index ? { ...element, sheet: Math.max(0, index - 1) } : element)),
  };
}

/** Swaps sheets `from` and `to`, with their elements. */
export function swapSheets(design: PdfCanvasDesign, from: number, to: number): PdfCanvasDesign {
  if (to < 0 || to >= design.sheets.length || from === to) return design;
  const sheets = [...design.sheets];
  [sheets[from], sheets[to]] = [sheets[to]!, sheets[from]!];
  return { ...design, sheets, elements: design.elements.map((element) => (element.sheet === from ? { ...element, sheet: to } : element.sheet === to ? { ...element, sheet: from } : element)) };
}

/** The element a validation path points at (`elements[3].content` → the fourth element). */
export function elementOfPath(design: PdfCanvasDesign, path: string): string | undefined {
  const match = /^elements\[(\d+)\]/.exec(path);
  return match === null ? undefined : design.elements[Number(match[1])]?.id;
}
