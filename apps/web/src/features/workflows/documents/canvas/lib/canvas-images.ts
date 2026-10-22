import { createContext, useContext } from 'react';
import type { PdfImage } from '../../api/documents-api';

export interface CanvasImages {
  readonly workflowId: string;
  /** The organization's logo; `null` when it has none, `undefined` while it loads. */
  readonly logoUrl: string | null | undefined;
  /** The workflow's images; `undefined` while they load (or when they could not be read). */
  readonly images: readonly PdfImage[] | undefined;
}

export const CanvasImagesContext = createContext<CanvasImages>({ workflowId: '', logoUrl: undefined, images: undefined });

export const useCanvasImages = (): CanvasImages => useContext(CanvasImagesContext);

/** The link that draws an image element in the editor, or `null` when there is nothing to draw (yet). */
export function imageUrlOf(element: { readonly source: 'TENANT_LOGO' | 'UPLOADED'; readonly imageId?: string | undefined }, images: CanvasImages): string | null {
  if (element.source === 'TENANT_LOGO') return images.logoUrl ?? null;
  return images.images?.find((image) => image.id === element.imageId)?.url ?? null;
}
