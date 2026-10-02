import { describe, expect, it } from 'vitest';
import { detectFileFormat, judgeContent } from './detect-file-type.js';
import { allowedTypeOf } from './file-types.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

/** A minimal ZIP: local headers are not needed, only the central directory the sniffer reads. */
function buildZip(names: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const central: number[] = [];
  for (const name of names) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(28, encoder.encode(name).length, true);
    central.push(...header, ...encoder.encode(name));
  }
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, names.length, true);
  view.setUint32(12, central.length, true);
  view.setUint32(16, 4, true);
  return Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...central, ...eocd]);
}

describe('detectFileFormat', () => {
  it.each([
    ['PDF', text('%PDF-1.7\n...')],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)],
    ['GIF', text('GIF89a....')],
    ['WEBP', Uint8Array.from([...text('RIFF'), 1, 2, 3, 4, ...text('WEBPVP8 ')])],
    ['HEIC', Uint8Array.from([0, 0, 0, 24, ...text('ftypheic'), 0, 0])],
    ['OLE', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0)],
    ['CSV', text('a,b\n1,2\n')],
  ])('recognizes %s by its first bytes', (format, content) => {
    expect(detectFileFormat(content)).toBe(format);
  });

  it('tells OOXML apart from a plain ZIP using the central directory', () => {
    expect(detectFileFormat(buildZip(['[Content_Types].xml', 'word/document.xml']))).toBe('DOCX');
    expect(detectFileFormat(buildZip(['[Content_Types].xml', 'xl/workbook.xml']))).toBe('XLSX');
    expect(detectFileFormat(buildZip(['[Content_Types].xml', 'ppt/presentation.xml']))).toBe('PPTX');
    expect(detectFileFormat(buildZip(['photo.jpg']))).toBe('ZIP');
    expect(detectFileFormat(buildZip(['word/document.xml']))).toBe('ZIP');
  });

  it('treats a ZIP it cannot read as a plain ZIP', () => {
    expect(detectFileFormat(bytes(0x50, 0x4b, 0x03, 0x04, 1, 2, 3))).toBe('ZIP');
  });

  it.each([
    ['SVG', text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\u0000')],
    ['an empty file', new Uint8Array()],
    ['an executable', bytes(0x4d, 0x5a, 0x90, 0x00, 0x03)],
  ])('rejects %s', (_label, content) => {
    expect(detectFileFormat(content)).toBeUndefined();
  });
});

describe('judgeContent', () => {
  const declared = (name: string) => allowedTypeOf(name)!;

  it('accepts content that matches the extension and reports the canonical MIME type', () => {
    expect(judgeContent(text('%PDF-1.4'), declared('contract.PDF'))).toEqual({ ok: true, mime: 'application/pdf' });
    expect(judgeContent(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), declared('old.xls'))).toEqual({ ok: true, mime: 'application/vnd.ms-excel' });
  });

  it('rejects HTML renamed as an image', () => {
    expect(judgeContent(text('<html><script>alert(1)</script></html>'), declared('photo.png'))).toEqual({ ok: false, reason: 'TYPE_MISMATCH' });
  });

  it('rejects a plain ZIP declared as .docx but accepts an Office file declared as .zip', () => {
    expect(judgeContent(buildZip(['a.txt']), declared('report.docx'))).toEqual({ ok: false, reason: 'TYPE_MISMATCH' });
    expect(judgeContent(buildZip(['[Content_Types].xml', 'word/document.xml']), declared('bundle.zip'))).toEqual({ ok: true, mime: 'application/zip' });
    expect(judgeContent(buildZip(['[Content_Types].xml', 'word/document.xml']), declared('report.docx')).ok).toBe(true);
  });

  it('rejects binary content with no known signature', () => {
    expect(judgeContent(bytes(0x4d, 0x5a, 0x00), declared('data.csv'))).toEqual({ ok: false, reason: 'TYPE_NOT_ALLOWED' });
  });
});

describe('allowedTypeOf', () => {
  it('knows the whitelist and nothing else, SVG included', () => {
    expect(allowedTypeOf('a.svg')).toBeUndefined();
    expect(allowedTypeOf('a.exe')).toBeUndefined();
    expect(allowedTypeOf('noextension')).toBeUndefined();
    expect(allowedTypeOf('constructor')).toBeUndefined();
    expect(allowedTypeOf('x.JPEG')?.kind).toBe('IMAGE');
  });
});
