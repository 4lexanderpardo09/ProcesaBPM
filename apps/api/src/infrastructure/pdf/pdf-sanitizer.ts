import { PDFArray, PDFDict, type PDFDocument, PDFName, PDFRef } from 'pdf-lib';

const dict = (document: PDFDocument, value: unknown): PDFDict | undefined => {
  const resolved = value instanceof PDFRef ? document.context.lookup(value) : value;
  return resolved instanceof PDFDict ? resolved : undefined;
};

const FORBIDDEN_ANNOTATIONS: ReadonlySet<string> = new Set(['FileAttachment', 'RichMedia', 'Screen', 'Movie', 'Sound', '3D']);
const MAX_FIELD_NODES = 100_000;

/** Additional actions (calculate, format, keystroke scripts) hang from any node of the field tree, not only from widgets. */
function stripFieldActions(document: PDFDocument, root: PDFDict): void {
  const pending: PDFDict[] = [root];
  const seen = new Set<PDFDict>();
  while (pending.length > 0 && seen.size < MAX_FIELD_NODES) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    node.delete(PDFName.of('AA'));
    node.delete(PDFName.of('A'));
    for (const key of ['Fields', 'Kids']) {
      const children = node.lookupMaybe(PDFName.of(key), PDFArray);
      if (children === undefined) continue;
      for (let index = 0; index < children.size(); index += 1) {
        const child = dict(document, children.get(index));
        if (child !== undefined) pending.push(child);
      }
    }
  }
}

/**
 * Removes what could run or hide things when a customer's PDF is opened or forwarded: open actions and additional actions,
 * JavaScript and embedded files in the name tree, XFA forms, bookmarks, the actions of annotations (links, buttons) and of every form field, and the annotations that carry files or media. The filled
 * values and the page content stay as they are.
 */
export function sanitizePdf(document: PDFDocument): void {
  const catalog = document.catalog;
  for (const key of ['OpenAction', 'AA', 'URI', 'Perms', 'Outlines']) catalog.delete(PDFName.of(key));

  const names = dict(document, catalog.get(PDFName.of('Names')));
  if (names !== undefined) for (const key of ['JavaScript', 'EmbeddedFiles']) names.delete(PDFName.of(key));

  const acroForm = dict(document, catalog.get(PDFName.of('AcroForm')));
  acroForm?.delete(PDFName.of('XFA'));
  if (acroForm !== undefined) stripFieldActions(document, acroForm);

  for (const page of document.getPages()) {
    page.node.delete(PDFName.of('AA'));
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annotations === undefined) continue;
    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const annotation = dict(document, annotations.get(index));
      if (annotation === undefined) continue;
      const subtype = annotation.get(PDFName.of('Subtype'));
      if (subtype instanceof PDFName && FORBIDDEN_ANNOTATIONS.has(subtype.decodeText())) {
        annotations.remove(index);
        continue;
      }
      annotation.delete(PDFName.of('A'));
      annotation.delete(PDFName.of('AA'));
    }
  }
}
