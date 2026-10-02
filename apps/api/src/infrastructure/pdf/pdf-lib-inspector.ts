import { PdfTemplateInvalidError, type AcroFieldInfo, PDF_LIMITS, type PageBox } from '@procesabpm/shared';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField } from 'pdf-lib';
import { type InspectedPdf, PdfInspector } from './pdf-renderer.js';

const isEncryptionError = (error: unknown): boolean => error instanceof Error && /is encrypted/.test(error.message);

export const LOAD_OPTIONS = { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, capNumbers: true } as const;
const MIN_PAGE_POINTS = 36;
const MAX_PAGE_POINTS = 14_400;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

const fieldType = (field: unknown): AcroFieldInfo['type'] => {
  if (field instanceof PDFTextField) return 'TEXT';
  if (field instanceof PDFCheckBox) return 'CHECKBOX';
  if (field instanceof PDFRadioGroup) return 'RADIO';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return 'DROPDOWN';
  if (field instanceof PDFSignature) return 'SIGNATURE';
  return 'BUTTON';
};

/** Loads an uploaded PDF the way every later step will, and refuses the ones that are not safe or sensible to use as a template. */
export class PdfLibInspector extends PdfInspector {
  async inspect(bytes: Uint8Array): Promise<InspectedPdf> {
    if (!PDF_HEADER.every((byte, index) => bytes[index] === byte)) throw new PdfTemplateInvalidError('NOT_PDF');
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, LOAD_OPTIONS);
    } catch (error) {
      throw new PdfTemplateInvalidError(isEncryptionError(error) ? 'ENCRYPTED' : 'MALFORMED');
    }
    try {
      return this.describe(document);
    } catch (error) {
      if (error instanceof PdfTemplateInvalidError) throw error;
      throw new PdfTemplateInvalidError('MALFORMED');
    }
  }

  private describe(document: PDFDocument): InspectedPdf {
    if (document.context.enumerateIndirectObjects().length > PDF_LIMITS.maxIndirectObjects) throw new PdfTemplateInvalidError('TOO_COMPLEX');
    const pages = document.getPages();
    if (pages.length === 0) throw new PdfTemplateInvalidError('MALFORMED');
    if (pages.length > PDF_LIMITS.maxTemplatePages) throw new PdfTemplateInvalidError('TOO_MANY_PAGES');

    const boxes: PageBox[] = pages.map((page) => {
      const { x, y, width, height } = page.getMediaBox();
      const angle = (((page.getRotation().angle % 360) + 360) % 360) as PageBox['rotation'];
      return { mediaBox: { x, y, w: width, h: height }, rotation: angle === 90 || angle === 180 || angle === 270 ? angle : 0 };
    });
    if (boxes.some((box) => box.mediaBox.w < MIN_PAGE_POINTS || box.mediaBox.h < MIN_PAGE_POINTS || box.mediaBox.w > MAX_PAGE_POINTS || box.mediaBox.h > MAX_PAGE_POINTS)) throw new PdfTemplateInvalidError('PAGE_SIZE');

    const pageRefs = pages.map((page) => page.ref);
    const acroformFields: AcroFieldInfo[] = [];
    try {
      for (const field of document.getForm().getFields()) {
        const widget = field.acroField.getWidgets()[0];
        const rect = widget?.getRectangle();
        const pageRef = widget?.P();
        const index = pageRef === undefined ? -1 : pageRefs.findIndex((ref) => ref === pageRef);
        acroformFields.push({ name: field.getName(), type: fieldType(field), page: index === -1 ? null : index + 1, rect: rect === undefined ? null : { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
      }
    } catch {
      throw new PdfTemplateInvalidError('MALFORMED');
    }
    return { pages: boxes, acroformFields };
  }
}
