import type { PageBox } from '@procesabpm/shared';

/** A page of the template as people see it (rotation applied), in PDF points. */
export interface PageInfo {
  readonly width: number;
  readonly height: number;
  /** What the API's checks know of the page: the media box and its rotation. */
  readonly box: PageBox;
}

export interface LoadedPdf {
  readonly pages: readonly PageInfo[];
  /** Draws a page into the canvas at that many pixels per point. */
  render(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  destroy(): void;
}

const ROTATIONS = [0, 90, 180, 270] as const;

/**
 * Opens a PDF with pdf.js, loaded only when a template is being mapped (it is large) and run in its worker.
 * The file comes from a presigned URL, so the bucket must allow the web origin to read it.
 */
export async function loadPdf(url: string): Promise<LoadedPdf> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ url });
  const document = await task.promise;
  const pages: PageInfo[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    const rotation = ROTATIONS.find((candidate) => candidate === ((page.rotate % 360) + 360) % 360) ?? 0;
    pages.push({ width: viewport.width, height: viewport.height, box: { mediaBox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, rotation } });
  }
  return {
    pages,
    async render(pageNumber, canvas, scale) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
    },
    destroy: () => void task.destroy(),
  };
}
