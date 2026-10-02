import type { AcroFieldInfo, PageBox } from '@procesabpm/shared';
import type { Align, ResolvedBlock } from '../../modules/documents/domain/resolved-document.js';

export interface PdfMeta {
  readonly title: string;
  readonly createdAt: Date;
}

export interface RenderedPdf {
  readonly bytes: Uint8Array;
  readonly pageCount: number;
}

export interface ImageBytes {
  readonly bytes: Uint8Array;
}

export interface DesignJob {
  readonly page: { readonly width: number; readonly height: number; readonly margins: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } };
  readonly defaultFontSize: number;
  readonly body: readonly ResolvedBlock[];
  readonly header?: { readonly height: number; readonly resolve: (page: number, pages: number) => readonly ResolvedBlock[] } | undefined;
  readonly footer?: { readonly height: number; readonly resolve: (page: number, pages: number) => readonly ResolvedBlock[] } | undefined;
  readonly images: ReadonlyMap<string, ImageBytes>;
  readonly deadlineAt: number;
  readonly meta: PdfMeta;
}

/** A value to place into an uploaded PDF, already evaluated. */
export type FilledField =
  | { readonly mode: 'ACROFORM'; readonly name: string; readonly value: string }
  | { readonly mode: 'COORDINATES'; readonly page: number; readonly x: number; readonly y: number; readonly value: string; readonly fontSize: number; readonly maxWidth: number | null; readonly align: Align };

export type FilledSignature = {
  readonly target: { readonly mode: 'ACROFORM'; readonly name: string } | { readonly mode: 'COORDINATES'; readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly caption: string;
  readonly imageKey: string | null;
};

export interface TemplateJob {
  readonly template: Uint8Array;
  readonly fields: readonly FilledField[];
  readonly signatures: readonly FilledSignature[];
  readonly images: ReadonlyMap<string, ImageBytes>;
  readonly deadlineAt: number;
  readonly meta: PdfMeta;
}

/** Port of the PDF engine: draws designer documents and fills uploaded templates. */
export abstract class PdfRenderer {
  abstract renderDesign(job: DesignJob): Promise<RenderedPdf>;
  abstract fillTemplate(job: TemplateJob): Promise<RenderedPdf>;
}

export interface InspectedPdf {
  readonly pages: readonly PageBox[];
  readonly acroformFields: readonly AcroFieldInfo[];
}

/** Port: reads an uploaded PDF and rejects what cannot be a template (throws `PdfTemplateInvalidError`). */
export abstract class PdfInspector {
  abstract inspect(bytes: Uint8Array): Promise<InspectedPdf>;
}
