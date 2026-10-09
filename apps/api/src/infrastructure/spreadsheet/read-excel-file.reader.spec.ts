import { describe, expect, it } from 'vitest';
import { ReadExcelFileReader } from './read-excel-file.reader.js';
import { SpreadsheetReadError } from './spreadsheet-reader.js';
import { WriteExcelFileWriter } from './write-excel-file.writer.js';

const reader = new ReadExcelFileReader();
const limits = { maxUnzippedBytes: 10 * 1024 * 1024 };

describe('ReadExcelFileReader', () => {
  it('reads the first sheet, numbers as numbers and text as text', async () => {
    const workbook = await new WriteExcelFileWriter().write([
      { name: 'One', headers: ['ID', 'Name'], rows: [[7, 'Ana']] },
      { name: 'Two', headers: ['Other'], rows: [['ignored']] },
    ]);
    expect(await reader.readFirstSheet(workbook, limits)).toEqual([
      ['ID', 'Name'],
      [7, 'Ana'],
    ]);
  });

  it('refuses what is not a zip as unreadable', async () => {
    await expect(reader.readFirstSheet(Buffer.from('not a workbook'), limits)).rejects.toMatchObject({ reason: 'UNREADABLE' });
  });

  it('refuses a workbook that inflates past the limit before parsing it', async () => {
    const workbook = await new WriteExcelFileWriter().write([{ name: 'One', headers: ['ID'], rows: [[1]] }]);
    const error = await reader.readFirstSheet(workbook, { maxUnzippedBytes: 100 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpreadsheetReadError);
    expect(error).toMatchObject({ reason: 'TOO_LARGE_UNZIPPED' });
  });
});
