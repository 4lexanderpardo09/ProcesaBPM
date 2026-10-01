export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 15;
export const MAX_SUBMISSION_BYTES = 20 * 1024 * 1024;
export const MAX_PENDING_UPLOADS_PER_USER = 50;

export const FILE_KINDS = ['PDF', 'IMAGE', 'OFFICE', 'ZIP'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** What the first bytes of a file say it is. */
export type FileFormat = 'PDF' | 'JPEG' | 'PNG' | 'GIF' | 'WEBP' | 'HEIC' | 'OLE' | 'DOCX' | 'XLSX' | 'PPTX' | 'ZIP' | 'CSV';

export interface AllowedFileType {
  readonly format: FileFormat;
  readonly kind: FileKind;
  readonly mime: string;
}

const OOXML = 'application/vnd.openxmlformats-officedocument';

/** The whitelist (docs/analisis.md §7.2), by extension. There is no SVG: it can carry scripts. */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, AllowedFileType>> = {
  pdf: { format: 'PDF', kind: 'PDF', mime: 'application/pdf' },
  jpg: { format: 'JPEG', kind: 'IMAGE', mime: 'image/jpeg' },
  jpeg: { format: 'JPEG', kind: 'IMAGE', mime: 'image/jpeg' },
  png: { format: 'PNG', kind: 'IMAGE', mime: 'image/png' },
  gif: { format: 'GIF', kind: 'IMAGE', mime: 'image/gif' },
  webp: { format: 'WEBP', kind: 'IMAGE', mime: 'image/webp' },
  heic: { format: 'HEIC', kind: 'IMAGE', mime: 'image/heic' },
  doc: { format: 'OLE', kind: 'OFFICE', mime: 'application/msword' },
  xls: { format: 'OLE', kind: 'OFFICE', mime: 'application/vnd.ms-excel' },
  ppt: { format: 'OLE', kind: 'OFFICE', mime: 'application/vnd.ms-powerpoint' },
  docx: { format: 'DOCX', kind: 'OFFICE', mime: `${OOXML}.wordprocessingml.document` },
  xlsx: { format: 'XLSX', kind: 'OFFICE', mime: `${OOXML}.spreadsheetml.sheet` },
  pptx: { format: 'PPTX', kind: 'OFFICE', mime: `${OOXML}.presentationml.presentation` },
  csv: { format: 'CSV', kind: 'OFFICE', mime: 'text/csv' },
  zip: { format: 'ZIP', kind: 'ZIP', mime: 'application/zip' },
};

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function allowedTypeOf(fileName: string): AllowedFileType | undefined {
  return Object.hasOwn(ALLOWED_FILE_TYPES, extensionOf(fileName)) ? ALLOWED_FILE_TYPES[extensionOf(fileName)] : undefined;
}

export function kindOfMime(mime: string): FileKind | undefined {
  return Object.values(ALLOWED_FILE_TYPES).find((type) => type.mime === mime)?.kind;
}
