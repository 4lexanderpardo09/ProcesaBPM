import type { AllowedFileType, FileFormat } from './file-types.js';

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'];
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const MAX_EOCD_SEARCH = 65_535 + EOCD_MIN_LENGTH;
const ZIP64_MARKER = 0xffff;
const ZIP64_OFFSET_MARKER = 0xffffffff;

function isHeic(bytes: Uint8Array): boolean {
  return startsWith(bytes, ascii('ftyp'), 4) && bytes.length >= 12 && HEIC_BRANDS.includes(String.fromCharCode(...bytes.subarray(8, 12)));
}

function findEndOfCentralDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let offset = view.byteLength - EOCD_MIN_LENGTH; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/** Names of the entries of a ZIP (read from its central directory), or undefined when it is not a plain, readable ZIP. */
function zipEntryNames(bytes: Uint8Array): string[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return undefined;
  const total = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (total === ZIP64_MARKER || directoryOffset === ZIP64_OFFSET_MARKER) return undefined;
  let cursor = directoryOffset;
  const names: string[] = [];
  for (let entry = 0; entry < total; entry += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) return undefined;
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (cursor + 46 + nameLength > view.byteLength) return undefined;
    names.push(new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function zipFormat(bytes: Uint8Array): FileFormat {
  const names = zipEntryNames(bytes);
  if (names === undefined || !names.includes('[Content_Types].xml')) return 'ZIP';
  if (names.some((name) => name.startsWith('word/'))) return 'DOCX';
  if (names.some((name) => name.startsWith('xl/'))) return 'XLSX';
  if (names.some((name) => name.startsWith('ppt/'))) return 'PPTX';
  return 'ZIP';
}

/** Detects the format from the content, never from the name or the browser's MIME type. Undefined means "not allowed". */
export function detectFileFormat(bytes: Uint8Array): FileFormat | undefined {
  if (bytes.length === 0) return undefined;
  if (startsWith(bytes, ascii('%PDF-'))) return 'PDF';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'JPEG';
  if (startsWith(bytes, PNG)) return 'PNG';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'GIF';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'WEBP';
  if (isHeic(bytes)) return 'HEIC';
  if (startsWith(bytes, OLE)) return 'OLE';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return zipFormat(bytes);
  return bytes.includes(0) ? undefined : 'CSV';
}

export type ContentVerdict = { readonly ok: true; readonly mime: string } | { readonly ok: false; readonly reason: 'TYPE_NOT_ALLOWED' | 'TYPE_MISMATCH' };

/** The detected format must be the one the extension promises; a ZIP that turns out to be an Office file is still a ZIP. */
export function judgeContent(bytes: Uint8Array, declared: AllowedFileType): ContentVerdict {
  const detected = detectFileFormat(bytes);
  if (detected === undefined) return { ok: false, reason: 'TYPE_NOT_ALLOWED' };
  const isOfficeZip = declared.format === 'ZIP' && (detected === 'DOCX' || detected === 'XLSX' || detected === 'PPTX');
  return detected === declared.format || isOfficeZip ? { ok: true, mime: declared.mime } : { ok: false, reason: 'TYPE_MISMATCH' };
}
