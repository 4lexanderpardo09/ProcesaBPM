import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { PdfTemplateInvalidError } from '@procesabpm/shared';
import type { ResolvedBlock } from '../../modules/documents/domain/resolved-document.js';
import { FileFontProvider } from './font-provider.js';
import { PdfLibInspector } from './pdf-lib-inspector.js';
import { PdfLibRenderer } from './pdf-lib-renderer.js';
import { sanitizePdf } from './pdf-sanitizer.js';

const renderer = new PdfLibRenderer(new FileFontProvider());
const inspector = new PdfLibInspector();
const meta = { title: 'Documento', createdAt: new Date('2026-10-02T10:00:00Z') };
const deadlineAt = () => Date.now() + 20_000;
const textOf = async (bytes: Uint8Array): Promise<string> => (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text;

const designJob = (body: ResolvedBlock[], extra: Record<string, unknown> = {}) => ({
  page: { width: 595, height: 842, margins: { top: 54, right: 54, bottom: 54, left: 54 } },
  defaultFontSize: 10,
  body,
  images: new Map(),
  deadlineAt: deadlineAt(),
  meta,
  ...extra,
});

describe('PdfLibRenderer.renderDesign', () => {
  it('draws Spanish text with the embedded font: accents, ñ, inverted punctuation and the euro sign survive', async () => {
    const { bytes, pageCount } = await renderer.renderDesign(designJob([{ type: 'heading', text: 'Señor Muñoz – Acción', level: 1 }, { type: 'text', text: '¿Cuánto cuesta? ¡Mucho! 1.500.000 € — Ángel Ñandú' }]));
    expect(pageCount).toBe(1);
    const text = await textOf(bytes);
    expect(text).toContain('Señor Muñoz – Acción');
    expect(text).toContain('¿Cuánto cuesta? ¡Mucho! 1.500.000 €');
    expect(text).toContain('Ángel Ñandú');
  });

  it('puts the metadata in and embeds a subset of the font', async () => {
    const { bytes } = await renderer.renderDesign(designJob([{ type: 'text', text: 'hola' }]));
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(loaded.getTitle()).toBe('Documento');
    expect(loaded.getProducer()).toBe('ProcesaBPM');
    expect(loaded.getCreationDate()?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(bytes.length).toBeLessThan(120_000);
  });

  it('a character the font does not have becomes a question mark instead of breaking the document', async () => {
    const { bytes } = await renderer.renderDesign(designJob([{ type: 'text', text: 'ok 😀 fin' }]));
    expect(await textOf(bytes)).toContain('ok ? fin');
  });

  it('paginates a long table, repeats its header and numbers the pages in the footer', async () => {
    const rows = Array.from({ length: 120 }, (_v, index) => [`Producto ${index}`, `${index * 10}`]);
    const { bytes, pageCount } = await renderer.renderDesign(
      designJob([{ type: 'table', headers: ['Ítem', 'Valor'], columns: [{ width: { fr: 3 } }, { width: { pt: 80 }, align: 'RIGHT' }], rows, repeatHeader: true, totals: ['Total', '59.400'] }], {
        footer: { height: 20, resolve: (page: number, pages: number): ResolvedBlock[] => [{ type: 'text', text: `Página ${page} de ${pages}`, align: 'CENTER' }] },
      }),
    );
    expect(pageCount).toBeGreaterThan(2);
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const pages = (await extractText(document, { mergePages: false })).text;
    expect(pages).toHaveLength(pageCount);
    expect(pages[1]).toContain('Ítem');
    expect(pages[pageCount - 1]).toContain('Total');
    expect(pages[0]).toContain(`Página 1 de ${pageCount}`);
    expect(pages.join(' ')).toContain('Producto 119');
  });

  it('draws a signature image and caption', async () => {
    const png = await (async () => {
      const source = await PDFDocument.create();
      void source;
      return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    })();
    const { bytes } = await renderer.renderDesign(designJob([{ type: 'signatures', perRow: 1, height: 50, slots: [{ caption: 'Firmado por Ana Gómez · 01/10/2026', imageKey: 'sig' }] }], { images: new Map([['sig', { bytes: png }]]) }));
    expect(await textOf(bytes)).toContain('Firmado por Ana Gómez');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.context.enumerateIndirectObjects().some(([, object]) => ((object as { dict?: PDFDict }).dict ?? object) instanceof PDFDict && ((object as { dict?: PDFDict }).dict ?? (object as PDFDict)).get(PDFName.of('Subtype'))?.toString() === '/Image')).toBe(true);
  });

  it('gives up at the deadline', async () => {
    await expect(renderer.renderDesign(designJob([{ type: 'text', text: 'x' }], { deadlineAt: Date.now() - 1 }))).rejects.toMatchObject({ name: 'RenderLimitError' });
  });
});

async function formTemplate(rotation = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  if (rotation !== 0) page.setRotation(degrees(rotation));
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Formulario de ejemplo', { x: 40, y: 560, size: 14, font });
  const form = document.getForm();
  form.createTextField('numero').addToPage(page, { x: 40, y: 500, width: 200, height: 20 });
  form.createTextField('nombre').addToPage(page, { x: 40, y: 460, width: 200, height: 20 });
  form.createCheckBox('acepta').addToPage(page, { x: 40, y: 420, width: 15, height: 15 });
  form.createDropdown('ciudad').addToPage(page, { x: 40, y: 380, width: 150, height: 20 });
  form.getDropdown('ciudad').addOptions(['Bogotá', 'Medellín']);
  form.createTextField('firma').addToPage(page, { x: 40, y: 300, width: 150, height: 50 });
  return document.save();
}

describe('PdfLibRenderer.fillTemplate and PdfLibInspector', () => {
  it('inspects the pages and the AcroForm fields of a template', async () => {
    const inspected = await inspector.inspect(await formTemplate(90));
    expect(inspected.pages).toEqual([{ mediaBox: { x: 0, y: 0, w: 400, h: 600 }, rotation: 90 }]);
    expect(inspected.acroformFields.map((field) => [field.name, field.type, field.page])).toEqual([['numero', 'TEXT', 1], ['nombre', 'TEXT', 1], ['acepta', 'CHECKBOX', 1], ['ciudad', 'DROPDOWN', 1], ['firma', 'TEXT', 1]]);
  });

  it('fills AcroForm fields by name, draws coordinate text, and flattens: the result has no form left, only text', async () => {
    const { bytes } = await renderer.fillTemplate({
      template: await formTemplate(),
      fields: [
        { mode: 'ACROFORM', name: 'numero', value: 'TK-1045' },
        { mode: 'ACROFORM', name: 'nombre', value: 'Señor Muñoz' },
        { mode: 'ACROFORM', name: 'acepta', value: 'Sí' },
        { mode: 'ACROFORM', name: 'ciudad', value: 'Medellín' },
        { mode: 'ACROFORM', name: 'no_existe', value: 'ignorado' },
        { mode: 'COORDINATES', page: 1, x: 40, y: 250, value: 'Texto libre en coordenadas con tildes: Ñandú', fontSize: 10, maxWidth: 300, align: 'LEFT' },
      ],
      signatures: [{ target: { mode: 'ACROFORM', name: 'firma' }, caption: 'Firmado por Ana Gómez', imageKey: null }],
      images: new Map(),
      deadlineAt: deadlineAt(),
      meta,
    });
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
    const text = await textOf(bytes);
    for (const expected of ['TK-1045', 'Señor Muñoz', 'Medellín', 'Texto libre en coordenadas con tildes: Ñandú', 'Firmado por Ana Gómez', 'Formulario de ejemplo']) expect(text).toContain(expected);
  });

  it('places coordinate text on a rotated page so that it reads upright', async () => {
    const { bytes } = await renderer.fillTemplate({ template: await formTemplate(90), fields: [{ mode: 'COORDINATES', page: 1, x: 100, y: 100, value: 'Girado', fontSize: 12, maxWidth: null, align: 'LEFT' }], signatures: [], images: new Map(), deadlineAt: deadlineAt(), meta });
    expect(await textOf(bytes)).toContain('Girado');
  });

  it('a template with a checkbox: any "false" value leaves it unchecked', async () => {
    const { bytes } = await renderer.fillTemplate({ template: await formTemplate(), fields: [{ mode: 'ACROFORM', name: 'acepta', value: 'no' }], signatures: [], images: new Map(), deadlineAt: deadlineAt(), meta });
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
  });
});

describe('what the inspector refuses', () => {
  it('something that is not a PDF', async () => {
    await expect(inspector.inspect(new TextEncoder().encode('<html>no</html>'))).rejects.toMatchObject({ reason: 'NOT_PDF' });
  });
  it('a damaged PDF', async () => {
    await expect(inspector.inspect(new TextEncoder().encode('%PDF-1.7\nnot really'))).rejects.toMatchObject({ reason: 'MALFORMED' });
  });
  it('an encrypted PDF', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const encrypt = document.context.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFString.of('x'.repeat(32)), U: PDFString.of('y'.repeat(32)), P: -4 });
    document.context.trailerInfo.Encrypt = document.context.register(encrypt);
    await expect(inspector.inspect(await document.save())).rejects.toMatchObject({ reason: 'ENCRYPTED' });
  });
  it('more pages than allowed', async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 51; page += 1) document.addPage();
    await expect(inspector.inspect(await document.save())).rejects.toBeInstanceOf(PdfTemplateInvalidError);
    await expect(inspector.inspect(await document.save())).rejects.toMatchObject({ reason: 'TOO_MANY_PAGES' });
  });
  it('absurd page sizes', async () => {
    const document = await PDFDocument.create();
    document.addPage([20000, 20000]);
    await expect(inspector.inspect(await document.save())).rejects.toMatchObject({ reason: 'PAGE_SIZE' });
  });
});

describe('sanitizePdf', () => {
  it('removes open actions, JavaScript, embedded files, XFA and the actions of links', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const { context } = document;
    const action = context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    document.catalog.set(PDFName.of('OpenAction'), action);
    document.catalog.set(PDFName.of('AA'), context.obj({ WC: action }));
    document.catalog.set(PDFName.of('Names'), context.obj({ JavaScript: context.obj({ Names: [] }), EmbeddedFiles: context.obj({ Names: [] }), Dests: context.obj({}) }));
    const acroForm = context.obj({ Fields: [], XFA: context.obj({}) });
    document.catalog.set(PDFName.of('AcroForm'), acroForm);
    const link = context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: context.obj({ S: 'URI', URI: PDFString.of('https://evil.test') }), AA: action });
    page.node.set(PDFName.of('Annots'), context.obj([link]));

    sanitizePdf(document);
    const reloaded = await PDFDocument.load(await document.save());
    expect(reloaded.catalog.has(PDFName.of('OpenAction'))).toBe(false);
    expect(reloaded.catalog.has(PDFName.of('AA'))).toBe(false);
    const names = reloaded.catalog.lookup(PDFName.of('Names'), PDFDict);
    expect(names.has(PDFName.of('JavaScript'))).toBe(false);
    expect(names.has(PDFName.of('EmbeddedFiles'))).toBe(false);
    expect(names.has(PDFName.of('Dests'))).toBe(true);
    expect(reloaded.catalog.lookup(PDFName.of('AcroForm'), PDFDict).has(PDFName.of('XFA'))).toBe(false);
    const annotation = reloaded.getPages()[0]!.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
    expect(annotation.has(PDFName.of('A'))).toBe(false);
    expect(annotation.has(PDFName.of('AA'))).toBe(false);
  });
});
