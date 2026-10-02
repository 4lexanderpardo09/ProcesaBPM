import type { FileKind } from '@procesabpm/shared';

/** PDFs and images open in the browser; everything else is downloaded, so uploaded content is never rendered as a page. */
export const dispositionOf = (kind: FileKind | undefined): 'inline' | 'attachment' => (kind === 'PDF' || kind === 'IMAGE' ? 'inline' : 'attachment');
