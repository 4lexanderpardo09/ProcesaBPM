import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { combinePdf } from './pdf-combiner.js';

const PNG_1X1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));

async function pdfOf(pages: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index++) document.addPage();
  return document.save();
}

describe('combinePdf', () => {
  it('puts the pages of each PDF and a page per image one after the other', async () => {
    const { bytes, skipped } = await combinePdf(
      [
        { name: 'orden.pdf', mimeType: 'application/pdf', bytes: await pdfOf(2) },
        { name: 'foto.png', mimeType: 'image/png', bytes: PNG_1X1 },
        { name: 'anexo.pdf', mimeType: 'application/pdf', bytes: await pdfOf(1) },
      ],
      'Ticket 42',
    );
    const combined = await PDFDocument.load(bytes);
    expect(combined.getPageCount()).toBe(4);
    expect(combined.getTitle()).toBe('Ticket 42');
    expect(skipped).toEqual([]);
  });

  it('leaves out what cannot be read and names it', async () => {
    const { bytes, skipped } = await combinePdf(
      [
        { name: 'roto.pdf', mimeType: 'application/pdf', bytes: Uint8Array.from(Buffer.from('%PDF-1.4 not really')) },
        { name: 'roto.jpg', mimeType: 'image/jpeg', bytes: Uint8Array.from([1, 2, 3]) },
        { name: 'bueno.pdf', mimeType: 'application/pdf', bytes: await pdfOf(1) },
      ],
      'T',
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(skipped).toEqual(['roto.pdf', 'roto.jpg']);
  });
});
