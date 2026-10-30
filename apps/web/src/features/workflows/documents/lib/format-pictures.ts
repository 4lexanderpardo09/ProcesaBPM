import { AI_FORMAT_IMAGE_LIMITS, type AiFormatImage } from '@procesabpm/shared';
import { loadPdf } from '@/shared/lib/pdf-pages';

/** A picture ready to send, with a preview to show before sending. */
export interface FormatPicture {
  readonly image: AiFormatImage;
  readonly previewUrl: string;
}

export class UnreadablePictureError extends Error {
  constructor() {
    super('The file is neither a picture nor a PDF the browser can read');
    this.name = 'UnreadablePictureError';
  }
}

const QUALITIES = [0.85, 0.75, 0.65, 0.5] as const;

/** The canvas as a JPEG small enough for the request: the quality goes down until it fits. */
function encode(canvas: HTMLCanvasElement): FormatPicture {
  for (const quality of QUALITIES) {
    const url = canvas.toDataURL('image/jpeg', quality);
    const data = url.slice(url.indexOf(',') + 1);
    if (data.length <= AI_FORMAT_IMAGE_LIMITS.base64Chars) return { image: { mediaType: 'image/jpeg', data }, previewUrl: url };
  }
  throw new UnreadablePictureError();
}

/** A canvas with the picture drawn at most `longSidePx` on its long side, on white (a PNG may be transparent). */
function canvasFor(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; scale: number } {
  const scale = Math.min(1, AI_FORMAT_IMAGE_LIMITS.longSidePx / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (context === null) throw new UnreadablePictureError();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context, scale };
}

async function fromImage(file: File): Promise<FormatPicture> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new UnreadablePictureError();
    });
    const { canvas, context } = canvasFor(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return encode(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromPdf(file: File, room: number): Promise<FormatPicture[]> {
  const url = URL.createObjectURL(file);
  const pdf = await loadPdf(url).catch(() => {
    URL.revokeObjectURL(url);
    throw new UnreadablePictureError();
  });
  try {
    const pictures: FormatPicture[] = [];
    for (const [index, page] of pdf.pages.slice(0, room).entries()) {
      const rendered = document.createElement('canvas');
      await pdf.render(index + 1, rendered, Math.min(3, AI_FORMAT_IMAGE_LIMITS.longSidePx / Math.max(page.width, page.height)));
      const { canvas, context } = canvasFor(rendered.width, rendered.height);
      context.drawImage(rendered, 0, 0, canvas.width, canvas.height);
      pictures.push(encode(canvas));
    }
    return pictures;
  } finally {
    pdf.destroy();
    URL.revokeObjectURL(url);
  }
}

/**
 * Turns photos and PDFs of a paper format into the pictures Jiro reads: each photo, and each PDF page, becomes a JPEG
 * of at most 1 568 px on its long side (what the model reads best), up to `room` pictures. Nothing leaves the browser
 * until the request is sent.
 */
export async function toFormatPictures(files: readonly File[], room: number): Promise<FormatPicture[]> {
  const pictures: FormatPicture[] = [];
  for (const file of files) {
    const left = room - pictures.length;
    if (left <= 0) break;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) pictures.push(...(await fromPdf(file, left)));
    else if (file.type.startsWith('image/')) pictures.push(await fromImage(file));
    else throw new UnreadablePictureError();
  }
  return pictures;
}
