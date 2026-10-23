import { PDFDocument } from 'pdf-lib';

export interface CombinablePart {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** A4 in points: an image gets a page of its own, scaled down to fit inside the margins. */
const PAGE = { width: 595.28, height: 841.89, margin: 36 };

/**
 * Puts PDFs and images (PNG, JPEG) one after the other in a single PDF. A part that cannot be read (encrypted or
 * damaged PDF, broken image) is left out and named in `skipped`, so one bad file never spoils the rest.
 */
export async function combinePdf(parts: readonly CombinablePart[], title: string): Promise<{ bytes: Uint8Array; skipped: string[] }> {
  const combined = await PDFDocument.create();
  combined.setTitle(title);
  const skipped: string[] = [];
  for (const part of parts) {
    try {
      if (part.mimeType === 'application/pdf') {
        const source = await PDFDocument.load(part.bytes);
        for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page);
      } else {
        const image = part.mimeType === 'image/png' ? await combined.embedPng(part.bytes) : await combined.embedJpg(part.bytes);
        const scale = Math.min(1, (PAGE.width - 2 * PAGE.margin) / image.width, (PAGE.height - 2 * PAGE.margin) / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        combined.addPage([PAGE.width, PAGE.height]).drawImage(image, { x: (PAGE.width - width) / 2, y: PAGE.height - PAGE.margin - height, width, height });
      }
    } catch {
      skipped.push(part.name);
    }
  }
  return { bytes: await combined.save(), skipped };
}
