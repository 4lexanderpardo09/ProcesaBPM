import { PdfTemplateInvalidError, PDF_LIMITS } from '@procesabpm/shared';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFCheckBox, PDFDropdown, PDFFont, PDFPage, PDFRadioGroup, PDFTextField, degrees, rgb } from 'pdf-lib';
import { layoutDocument, RenderLimitError } from '../../modules/documents/domain/layout/flow-layout.js';
import { alignedX, clampLines, wrapText } from '../../modules/documents/domain/layout/text-wrap.js';
import type { DrawCommand, TextMeasurer } from '../../modules/documents/domain/resolved-document.js';
import { FontProvider } from './font-provider.js';
import { toUserSpace } from './page-geometry.js';
import { LOAD_OPTIONS } from './pdf-lib-inspector.js';
import { sanitizePdf } from './pdf-sanitizer.js';
import { type DesignJob, type FilledField, type FilledSignature, type ImageBytes, type PdfMeta, PdfRenderer, type RenderedPdf, type TemplateJob } from './pdf-renderer.js';

type EmbeddedImage = Awaited<ReturnType<PDFDocument['embedPng']>>;

const hexColor = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte);

/** The fonts of one document and what they can draw: a character the font lacks becomes `?` instead of failing the whole PDF. */
class Typography {
  private constructor(
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly regularSet: ReadonlySet<number>,
    private readonly boldSet: ReadonlySet<number>,
  ) {}

  static async embed(document: PDFDocument, fonts: FontProvider): Promise<Typography> {
    document.registerFontkit(fontkit);
    const [regular, bold] = [await document.embedFont(await fonts.regular(), { subset: true }), await document.embedFont(await fonts.bold(), { subset: true })];
    return new Typography(regular, bold, new Set(regular.getCharacterSet()), new Set(bold.getCharacterSet()));
  }

  font(bold: boolean): PDFFont {
    return bold ? this.bold : this.regular;
  }

  safe(text: string, bold: boolean): string {
    const set = bold ? this.boldSet : this.regularSet;
    return [...text].map((character) => (character === '\n' || set.has(character.codePointAt(0)!) ? character : '?')).join('');
  }

  get measurer(): TextMeasurer {
    return { width: (text, size, bold) => this.font(bold).widthOfTextAtSize(this.safe(text, bold), size) };
  }
}

function setMetadata(document: PDFDocument, meta: PdfMeta): void {
  document.setTitle(meta.title);
  document.setProducer('ProcesaBPM');
  document.setCreator('ProcesaBPM');
  document.setCreationDate(meta.createdAt);
  document.setModificationDate(meta.createdAt);
}

async function embedImages(document: PDFDocument, images: ReadonlyMap<string, ImageBytes>): Promise<Map<string, EmbeddedImage>> {
  const embedded = new Map<string, EmbeddedImage>();
  for (const [key, image] of images) {
    if (image.bytes.length > PDF_LIMITS.maxSignatureImageBytes * 4) continue;
    if (startsWith(image.bytes, PNG_SIGNATURE)) embedded.set(key, await document.embedPng(image.bytes));
    else if (startsWith(image.bytes, JPEG_SIGNATURE)) embedded.set(key, await document.embedJpg(image.bytes));
  }
  return embedded;
}

function drawImageFitting(page: PDFPage, image: EmbeddedImage, x: number, y: number, width: number, height: number): void {
  const scale = Math.min(width / image.width, height / image.height);
  const [w, h] = [image.width * scale, image.height * scale];
  page.drawImage(image, { x: x + (width - w) / 2, y: y + (height - h) / 2, width: w, height: h });
}

function drawCommand(command: DrawCommand, page: PDFPage, typography: Typography, images: ReadonlyMap<string, EmbeddedImage>): void {
  const height = page.getHeight();
  switch (command.kind) {
    case 'text': {
      const font = typography.font(command.bold);
      page.drawText(typography.safe(command.text, command.bold), { x: command.x, y: height - command.top - command.size * 0.95, size: command.size, font, color: hexColor(command.color) });
      break;
    }
    case 'rule':
      page.drawLine({ start: { x: command.x1, y: height - command.top }, end: { x: command.x2, y: height - command.top }, thickness: command.thickness, color: rgb(0.2, 0.2, 0.2) });
      break;
    case 'box':
      page.drawRectangle({ x: command.x, y: height - command.top - command.height, width: command.width, height: command.height, borderWidth: 0.6, borderColor: rgb(0.6, 0.6, 0.6) });
      break;
    case 'image': {
      const image = images.get(command.imageKey);
      if (image !== undefined) drawImageFitting(page, image, command.x, height - command.top - command.height, command.width, command.height);
      break;
    }
  }
}

/** pdf-lib (pure JavaScript, no browser): the designer lays blocks out itself and the engine draws what the layout says. */
export class PdfLibRenderer extends PdfRenderer {
  constructor(private readonly fonts: FontProvider) {
    super();
  }

  async renderDesign(job: DesignJob): Promise<RenderedPdf> {
    const document = await PDFDocument.create();
    setMetadata(document, job.meta);
    const typography = await Typography.embed(document, this.fonts);
    const images = await embedImages(document, job.images);
    const laid = layoutDocument({ page: job.page, defaultFontSize: job.defaultFontSize, body: job.body, header: job.header, footer: job.footer, measurer: typography.measurer, deadlineAt: job.deadlineAt });
    const pages = Array.from({ length: laid.pageCount }, () => document.addPage([job.page.width, job.page.height]));
    for (const command of laid.commands) drawCommand(command, pages[command.page - 1]!, typography, images);
    return { bytes: await document.save(), pageCount: laid.pageCount };
  }

  async fillTemplate(job: TemplateJob): Promise<RenderedPdf> {
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(job.template, LOAD_OPTIONS);
    } catch {
      throw new PdfTemplateInvalidError('MALFORMED');
    }
    sanitizePdf(document);
    setMetadata(document, job.meta);
    const typography = await Typography.embed(document, this.fonts);
    const images = await embedImages(document, job.images);
    const form = document.getForm();
    const pages = document.getPages();
    const boxes = pages.map((page) => ({ mediaBox: { x: page.getMediaBox().x, y: page.getMediaBox().y, w: page.getMediaBox().width, h: page.getMediaBox().height }, rotation: ((((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270) }));

    for (const field of job.fields) {
      if (Date.now() > job.deadlineAt) throw new RenderLimitError('TIMEOUT');
      if (field.mode === 'ACROFORM') fillAcroField(form, field, typography);
      else drawCoordinateText(pages, boxes, field, typography);
    }
    for (const signature of job.signatures) drawSignature(pages, boxes, form, signature, typography, images);

    form.updateFieldAppearances(typography.regular);
    try {
      form.flatten();
    } catch {
      // A field without a widget cannot be flattened: lock them all instead so the values cannot be edited.
      for (const field of form.getFields()) field.enableReadOnly();
    }
    return { bytes: await document.save(), pageCount: pages.length };
  }
}

const FALSE_VALUES = new Set(['', 'false', '0', 'no', 'no.', 'n']);

function fillAcroField(form: ReturnType<PDFDocument['getForm']>, field: Extract<FilledField, { mode: 'ACROFORM' }>, typography: Typography): void {
  const target = form.getFieldMaybe(field.name);
  if (target === undefined) return;
  const value = typography.safe(field.value, false);
  if (target instanceof PDFTextField) target.setText(value);
  else if (target instanceof PDFCheckBox) (FALSE_VALUES.has(field.value.trim().toLowerCase()) ? target.uncheck() : target.check());
  else if (target instanceof PDFRadioGroup || target instanceof PDFDropdown) {
    if (target.getOptions().includes(field.value)) target.select(field.value);
  }
}

function drawCoordinateText(pages: readonly PDFPage[], boxes: ReadonlyArray<Parameters<typeof toUserSpace>[0]>, field: Extract<FilledField, { mode: 'COORDINATES' }>, typography: Typography): void {
  const page = pages[field.page - 1];
  const box = boxes[field.page - 1];
  if (page === undefined || box === undefined) return;
  const lines = field.maxWidth === null ? [field.value.replace(/\n/g, ' ')] : clampLines(wrapText(field.value, field.maxWidth, field.fontSize, false, typography.measurer), 3, field.maxWidth, field.fontSize, false, typography.measurer);
  const lineHeight = field.fontSize * 1.2;
  for (const [index, line] of lines.entries()) {
    const width = typography.regular.widthOfTextAtSize(typography.safe(line, false), field.fontSize);
    const u = field.maxWidth === null ? field.x : alignedX(field.x, field.maxWidth, width, field.align);
    const at = toUserSpace(box, u, field.y - index * lineHeight);
    page.drawText(typography.safe(line, false), { x: at.x, y: at.y, size: field.fontSize, font: typography.regular, rotate: degrees(at.rotate) });
  }
}

function drawSignature(pages: readonly PDFPage[], boxes: ReadonlyArray<Parameters<typeof toUserSpace>[0]>, form: ReturnType<PDFDocument['getForm']>, signature: FilledSignature, typography: Typography, images: ReadonlyMap<string, EmbeddedImage>): void {
  const image = signature.imageKey === null ? undefined : images.get(signature.imageKey);
  if (signature.target.mode === 'COORDINATES') {
    const { page: pageNumber, x, y, width, height } = signature.target;
    const page = pages[pageNumber - 1];
    const box = boxes[pageNumber - 1];
    if (page === undefined || box === undefined) return;
    // Signature boxes are placed on unrotated pages; on a rotated page the box is drawn upright in user space.
    const at = toUserSpace(box, x, y);
    if (image !== undefined) drawImageFitting(page, image, at.x, at.y, width, height);
    const caption = typography.safe(signature.caption, false);
    if (caption !== '') page.drawText(caption, { x: at.x, y: at.y - 9, size: 7, font: typography.regular, rotate: degrees(at.rotate) });
    return;
  }
  const widget = form.getFieldMaybe(signature.target.name)?.acroField.getWidgets()[0];
  const rect = widget?.getRectangle();
  const pageRef = widget?.P();
  const page = pageRef === undefined ? undefined : pages.find((candidate) => candidate.ref === pageRef);
  if (rect === undefined || page === undefined) return;
  if (image !== undefined) drawImageFitting(page, image, rect.x, rect.y, rect.width, rect.height);
  const caption = typography.safe(signature.caption, false);
  if (caption !== '') page.drawText(caption, { x: rect.x, y: rect.y - 9, size: 7, font: typography.regular });
}
