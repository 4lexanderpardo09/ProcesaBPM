import type { PdfBlock, PdfDesign } from '@procesabpm/shared';

export type BlockType = PdfBlock['type'];
export type Band = 'header' | 'body' | 'footer';

export const BANDS: readonly Band[] = ['header', 'body', 'footer'];

/** In the order the palette offers them. */
export const BLOCK_TYPES: readonly BlockType[] = ['heading', 'text', 'fields', 'allFields', 'table', 'signatures', 'image', 'line', 'spacer', 'pageBreak'];

/** Header and footer bands repeat on every page: a page break or a growing table has no place there. */
export const BAND_BLOCK_TYPES: readonly BlockType[] = ['heading', 'text', 'fields', 'image', 'line', 'spacer'];

const DEFAULT_BAND_HEIGHT = 40;

/** A new block that already validates (or names what it still needs, like the table's field). */
export function newBlock(type: BlockType): PdfBlock {
  switch (type) {
    case 'heading':
      return { type, text: 'Título', level: 2 };
    case 'text':
      return { type, text: '' };
    case 'fields':
      return { type, items: [{ label: 'Número', value: '{{ticket.number}}' }], columns: 2, labelWidthPercent: 35 };
    case 'allFields':
      return { type };
    case 'table':
      return { type, fieldCode: '', columns: [{ header: 'Columna', value: '', width: { fr: 1 } }], repeatHeader: true } as unknown as PdfBlock;
    case 'signatures':
      return { type, slots: [{ stepName: '', signerType: 'STEP_ASSIGNEE' }], perRow: 3, height: 60 } as unknown as PdfBlock;
    case 'image':
      return { type, source: 'TENANT_LOGO', width: 120 };
    case 'line':
      return { type };
    case 'spacer':
      return { type, height: 12 };
    case 'pageBreak':
      return { type };
  }
}

export function blocksOf(design: PdfDesign, band: Band): readonly PdfBlock[] {
  return band === 'body' ? design.body : (design[band]?.blocks ?? []);
}

export function withBlocks(design: PdfDesign, band: Band, blocks: readonly PdfBlock[]): PdfDesign {
  if (band === 'body') return { ...design, body: [...blocks] };
  return { ...design, [band]: { height: design[band]?.height ?? DEFAULT_BAND_HEIGHT, blocks: [...blocks] } };
}

/** Turns the header or footer on (empty) or off (its blocks go with it). */
export function withBand(design: PdfDesign, band: Exclude<Band, 'body'>, on: boolean): PdfDesign {
  if (on) return { ...design, [band]: design[band] ?? { height: DEFAULT_BAND_HEIGHT, blocks: [] } };
  const { [band]: _removed, ...rest } = design;
  return rest;
}

export function addBlock(design: PdfDesign, band: Band, type: BlockType): PdfDesign {
  return withBlocks(design, band, [...blocksOf(design, band), newBlock(type)]);
}

export function replaceBlock(design: PdfDesign, band: Band, index: number, block: PdfBlock): PdfDesign {
  return withBlocks(design, band, blocksOf(design, band).map((current, at) => (at === index ? block : current)));
}

export function removeBlock(design: PdfDesign, band: Band, index: number): PdfDesign {
  return withBlocks(design, band, blocksOf(design, band).filter((_block, at) => at !== index));
}

export function moveBlock(design: PdfDesign, band: Band, index: number, step: -1 | 1): PdfDesign {
  const blocks = [...blocksOf(design, band)];
  const target = index + step;
  if (target < 0 || target >= blocks.length) return design;
  [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
  return withBlocks(design, band, blocks);
}

/** Where a problem's path points: `body[2].text` is the body's third block; `header.blocks[0]…` the header's first. */
export interface BlockRef {
  readonly band: Band;
  readonly index: number;
}

const PATH = /^(?:design\.)?(body|header\.blocks|footer\.blocks)\[(\d+)\]/;

export function blockOfPath(path: string): BlockRef | undefined {
  const match = PATH.exec(path);
  if (match === null) return undefined;
  return { band: match[1]!.split('.')[0] as Band, index: Number(match[2]) };
}

export const sameBlock = (a: BlockRef | undefined, b: BlockRef | undefined): boolean => a !== undefined && b !== undefined && a.band === b.band && a.index === b.index;

/** A short line that tells the blocks apart in the list (the start of a text, the table's field…). */
export function blockSummary(block: PdfBlock): string {
  const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
  switch (block.type) {
    case 'heading':
    case 'text':
      return clip(block.text);
    case 'fields':
      return clip(block.items.map((item) => item.label).join(', '));
    case 'table':
      return block.fieldCode;
    case 'signatures':
      return clip(block.slots.map((slot) => slot.stepName).join(', '));
    case 'allFields':
      return block.exclude === undefined || block.exclude.length === 0 ? '' : clip(block.exclude.join(', '));
    default:
      return '';
  }
}
