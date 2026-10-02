import writeXlsxFile from 'write-excel-file/node';
import { type Sheet, type SheetCell, SpreadsheetWriter } from './spreadsheet-writer.js';
import { safeCellText, safeSheetName } from './spreadsheet-text.js';

type Cell = { value: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold' } | null;

const cellOf = (cell: SheetCell): Cell => {
  if (cell === null) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? { value: cell, type: Number } : null;
  if (cell instanceof Date) return { value: cell, type: Date, format: 'yyyy-mm-dd hh:mm' };
  return { value: safeCellText(cell), type: String };
};

/** Adapter over `write-excel-file`: the workbook is built in memory, which the callers bound by capping the rows. */
export class WriteExcelFileWriter extends SpreadsheetWriter {
  async write(sheets: readonly Sheet[]): Promise<Buffer> {
    const taken = new Set<string>();
    const book = sheets.map((sheet) => {
      const name = safeSheetName(sheet.name, taken);
      taken.add(name.toLowerCase());
      const header: Cell[] = sheet.headers.map((title) => ({ value: safeCellText(title), type: String, fontWeight: 'bold' }));
      return { sheet: name, data: [header, ...sheet.rows.map((row) => row.map(cellOf))] };
    });
    const output = await writeXlsxFile(book as never).toBuffer();
    return Buffer.from(output);
  }
}
