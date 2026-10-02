import { PDFArray, PDFDict, type PDFDocument, PDFName, PDFRef } from 'pdf-lib';

const dict = (document: PDFDocument, value: unknown): PDFDict | undefined => {
  const resolved = value instanceof PDFRef ? document.context.lookup(value) : value;
  return resolved instanceof PDFDict ? resolved : undefined;
};

/**
 * Removes what could run or hide things when a customer's PDF is opened or forwarded: open actions and additional actions,
 * JavaScript and embedded files in the name tree, XFA forms, and the actions of annotations (links, buttons). The filled
 * values and the page content stay as they are.
 */
export function sanitizePdf(document: PDFDocument): void {
  const catalog = document.catalog;
  for (const key of ['OpenAction', 'AA', 'URI', 'Perms']) catalog.delete(PDFName.of(key));

  const names = dict(document, catalog.get(PDFName.of('Names')));
  if (names !== undefined) for (const key of ['JavaScript', 'EmbeddedFiles']) names.delete(PDFName.of(key));

  const acroForm = dict(document, catalog.get(PDFName.of('AcroForm')));
  acroForm?.delete(PDFName.of('XFA'));

  for (const page of document.getPages()) {
    page.node.delete(PDFName.of('AA'));
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annotations === undefined) continue;
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = dict(document, annotations.get(index));
      annotation?.delete(PDFName.of('A'));
      annotation?.delete(PDFName.of('AA'));
    }
  }
}
