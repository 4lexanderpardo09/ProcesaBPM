import { Injectable } from '@nestjs/common';
import { readSheet } from 'read-excel-file/node';
import yauzl from 'yauzl';
import { type ReadCell, SpreadsheetReadError, SpreadsheetReader } from './spreadsheet-reader.js';

/** More entries than any real workbook has: a zip made of thousands of tiny entries is refused before reading them. */
const MAX_ZIP_ENTRIES = 2_000;

/**
 * Adds up what every entry of the zip really inflates to, stopping as soon as it passes the limit. The sizes the zip
 * declares are not trusted on their own: yauzl checks each stream against its declared size, and the bytes are counted.
 * Nothing is kept in memory, so a zip bomb costs at most `maxUnzippedBytes` of CPU work, never of memory.
 */
function assertUnzippedSize(content: Buffer, maxUnzippedBytes: number): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(content, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError !== null || zip === undefined) return reject(new SpreadsheetReadError('UNREADABLE', { cause: openError }));
      let total = 0;
      let entries = 0;
      const fail = (error: SpreadsheetReadError) => {
        zip.close();
        reject(error);
      };
      zip.on('error', (error: unknown) => fail(new SpreadsheetReadError('UNREADABLE', { cause: error })));
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES || total + entry.uncompressedSize > maxUnzippedBytes) return fail(new SpreadsheetReadError('TOO_LARGE_UNZIPPED'));
        if (entry.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError !== null || stream === undefined) return fail(new SpreadsheetReadError('UNREADABLE', { cause: streamError }));
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxUnzippedBytes) {
              stream.destroy();
              fail(new SpreadsheetReadError('TOO_LARGE_UNZIPPED'));
            }
          });
          stream.on('error', (error: unknown) => fail(new SpreadsheetReadError('UNREADABLE', { cause: error })));
          stream.on('end', () => zip.readEntry());
        });
      });
      zip.readEntry();
    });
  });
}

/** `read-excel-file` behind the size check: the library inflates the whole workbook in memory. */
@Injectable()
export class ReadExcelFileReader extends SpreadsheetReader {
  async readFirstSheet(content: Uint8Array, limits: { readonly maxUnzippedBytes: number }): Promise<ReadCell[][]> {
    const buffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    await assertUnzippedSize(buffer, limits.maxUnzippedBytes);
    try {
      const rows = await readSheet(buffer, 1);
      return rows.map((row) => row.map((cell) => (cell instanceof Date || cell === null || typeof cell !== 'object' ? (cell as ReadCell) : null)));
    } catch (error) {
      throw new SpreadsheetReadError('UNREADABLE', { cause: error });
    }
  }
}
