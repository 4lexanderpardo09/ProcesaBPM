import type { CanvasStyle } from '@procesabpm/shared';

/**
 * A canvas design after it was evaluated against a ticket: only the elements whose condition held, with their texts,
 * rows and signers already worked out. Measures are millimetres from the top left corner of the sheet.
 */
export interface CanvasPage {
  readonly width: number;
  readonly height: number;
  /** What grows jumps to the next page before reaching this distance from the bottom. */
  readonly marginBottom: number;
}

/** Where a text is drawn: its page number and the document's page count, once they are known. */
export interface PageFrame {
  readonly page: number;
  readonly pages: number;
}

interface ElementBase {
  readonly id: string;
  /** Layer order: a higher one is drawn on top. */
  readonly order: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly repeat: boolean;
  /** Index of the sheet of the design (only the sheets whose condition held are laid out). */
  readonly sheet: number;
  readonly style: CanvasStyle;
}

export interface ResolvedSigner {
  readonly name: string;
  /** Already formatted, or `null` when not known. */
  readonly date: string | null;
  readonly imageKey: string | null;
}

export type ResolvedCanvasElement = ElementBase &
  (
    | {
        readonly type: 'text';
        /** Measured without a frame (page numbers are short); drawn with the page it lands on. */
        readonly text: (frame: PageFrame | undefined) => string;
        readonly grow: boolean;
      }
    | {
        readonly type: 'table';
        readonly showHeader: boolean;
        readonly headers: readonly string[];
        readonly headerStyle: CanvasStyle;
        readonly columns: ReadonlyArray<{ readonly align: 'LEFT' | 'CENTER' | 'RIGHT'; readonly weight: number }>;
        readonly rows: ReadonlyArray<readonly string[]>;
        /** The total row, already summed and formatted: `null` in a column that is not summed; no row at all when `null`. */
        readonly totals: ReadonlyArray<string | null> | null;
        readonly totalLabel: string;
        readonly zebra: string | null;
        readonly minRows: number;
        readonly emptyMessage: string;
      }
    | { readonly type: 'image'; readonly imageKey: string | null; readonly fit: 'CONTAIN' | 'COVER' | 'STRETCH' }
    | { readonly type: 'line'; readonly orientation: 'HORIZONTAL' | 'VERTICAL'; readonly thickness: number; readonly color: string; readonly dash: 'SOLID' | 'DASHED' | 'DOTTED' }
    | { readonly type: 'rectangle' }
    | {
        readonly type: 'signature';
        /** One box per signer side by side; `null` leaves the box blank to sign on paper. */
        readonly signers: ReadonlyArray<ResolvedSigner | null>;
        readonly label: string;
        readonly showName: boolean;
        readonly showDate: boolean;
        readonly showLine: boolean;
      }
  );

export interface CanvasContent {
  readonly page: CanvasPage;
  /** The sheets to print, in order, by their index in the design. */
  readonly sheets: readonly number[];
  readonly elements: readonly ResolvedCanvasElement[];
}

export type TextStyle = Pick<CanvasStyle, 'font' | 'size' | 'bold' | 'italic' | 'underline' | 'color'>;

/** One line of a text, placed: `top` is where the line box starts; `wordSpacing` stretches a justified line. */
export interface PlacedLine {
  readonly text: string;
  readonly x: number;
  readonly top: number;
  readonly width: number;
  readonly wordSpacing: number;
}

/** Drawing instructions in millimetres from the top left corner, per page (1-based). */
export type CanvasOp =
  | { readonly kind: 'box'; readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly background: string | null; readonly border: number; readonly borderColor: string; readonly radius: number }
  | { readonly kind: 'text'; readonly page: number; readonly clip: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly lines: readonly PlacedLine[]; readonly style: TextStyle }
  | { readonly kind: 'line'; readonly page: number; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly thickness: number; readonly color: string; readonly dash: 'SOLID' | 'DASHED' | 'DOTTED' }
  | { readonly kind: 'image'; readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly imageKey: string; readonly fit: 'CONTAIN' | 'COVER' | 'STRETCH' };

/** Measures text with the fonts that will be drawn, in points at the given size. */
export interface CanvasMeasurer {
  width(text: string, style: Pick<CanvasStyle, 'font' | 'bold' | 'italic' | 'size'>): number;
}
