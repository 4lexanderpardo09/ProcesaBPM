/** A design after its expressions were evaluated against a ticket: plain strings and numbers, ready to be laid out. */
export type Align = 'LEFT' | 'CENTER' | 'RIGHT';

export interface ResolvedSignatureSlot {
  /** Lines under the box: who signed and when, or the slot's caption. */
  readonly caption: string;
  /** Key of the signature image the renderer was given, when the signer has one. */
  readonly imageKey: string | null;
}

interface BlockSpacing {
  readonly spaceBefore?: number | undefined;
  readonly spaceAfter?: number | undefined;
}

export type ResolvedBlock = BlockSpacing &
  (
    | { readonly type: 'text'; readonly text: string; readonly fontSize?: number | undefined; readonly bold?: boolean | undefined; readonly align?: Align | undefined; readonly color?: string | undefined }
    | { readonly type: 'heading'; readonly text: string; readonly level: 1 | 2 | 3 }
    | { readonly type: 'fields'; readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>; readonly columns: 1 | 2 | 3; readonly labelWidthPercent: number }
    | {
        readonly type: 'table';
        readonly headers: readonly string[];
        readonly columns: ReadonlyArray<{ readonly width: { readonly pt: number } | { readonly fr: number }; readonly align?: Align | undefined }>;
        readonly rows: ReadonlyArray<readonly string[]>;
        readonly repeatHeader: boolean;
        /** A final row, already summed and formatted. */
        readonly totals?: readonly string[] | undefined;
      }
    | { readonly type: 'signatures'; readonly slots: readonly ResolvedSignatureSlot[]; readonly perRow: number; readonly height: number }
    | { readonly type: 'image'; readonly imageKey: string; readonly width: number; readonly height: number; readonly align?: Align | undefined }
    | { readonly type: 'line' }
    | { readonly type: 'spacer'; readonly height: number }
    | { readonly type: 'pageBreak' }
  );

/** Drawing instructions in points; `top` is the distance from the top of the page, as the designer thinks of it. */
export type DrawCommand =
  | { readonly kind: 'text'; readonly page: number; readonly x: number; readonly top: number; readonly text: string; readonly size: number; readonly bold: boolean; readonly color: string }
  | { readonly kind: 'rule'; readonly page: number; readonly x1: number; readonly x2: number; readonly top: number; readonly thickness: number }
  | { readonly kind: 'box'; readonly page: number; readonly x: number; readonly top: number; readonly width: number; readonly height: number }
  | { readonly kind: 'image'; readonly page: number; readonly imageKey: string; readonly x: number; readonly top: number; readonly width: number; readonly height: number };

/** Measures text with the font that will be embedded, so what is laid out is what is drawn. */
export interface TextMeasurer {
  width(text: string, size: number, bold: boolean): number;
}
