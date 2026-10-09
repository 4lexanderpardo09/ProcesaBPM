import { DATASET_MAX_CELL_CHARACTERS, DATASET_MAX_COLUMN_NAME, DATASET_MAX_COLUMNS, DATASET_MAX_ROWS, type DatasetColumn, DatasetFileInvalidError } from '@procesabpm/shared';
import type { ReadCell } from '../../../infrastructure/spreadsheet/spreadsheet-reader.js';

export interface DatasetSheetRow {
  /** Only the non-empty cells, by column name. */
  readonly data: Record<string, string>;
  readonly lookupKey: string | null;
}

export interface DatasetSheet {
  readonly columns: readonly DatasetColumn[];
  readonly keyColumn: string | null;
  readonly rows: readonly DatasetSheetRow[];
}

const isMidnightUtc = (date: Date): boolean => date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;

/**
 * Every value is kept as text, because a form sends text and the submission check compares it as it is: an ID number
 * typed as `1234567890` must match the cell that the spreadsheet stored as the number 1234567890. A date without a time
 * becomes `YYYY-MM-DD`, the format of the date fields.
 */
export function cellText(cell: ReadCell): string {
  if (cell === null) return '';
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? '' : isMidnightUtc(cell) ? cell.toISOString().slice(0, 10) : cell.toISOString();
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return String(cell).trim();
}

/** The headers of the first row, without the empty cells after the last one; a gap between two headers is an error. */
function readHeaders(first: readonly ReadCell[] | undefined): string[] {
  const headers = (first ?? []).map(cellText);
  while (headers.length > 0 && headers.at(-1) === '') headers.pop();
  if (headers.length === 0) throw new DatasetFileInvalidError('NO_HEADERS');
  if (headers.length > DATASET_MAX_COLUMNS) throw new DatasetFileInvalidError('TOO_MANY_COLUMNS', DATASET_MAX_COLUMNS);
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (header === '') throw new DatasetFileInvalidError('EMPTY_HEADER', index + 1);
    if (header.length > DATASET_MAX_COLUMN_NAME) throw new DatasetFileInvalidError('HEADER_TOO_LONG', header.slice(0, 50));
    if (seen.has(header.toLowerCase())) throw new DatasetFileInvalidError('DUPLICATE_HEADER', header);
    seen.add(header.toLowerCase());
  });
  return headers;
}

/**
 * Turns the cells of the first sheet into a dataset: the first row names the columns and every other non-empty row is
 * a record. Cells to the right of the last header are ignored. With a key column, every row needs a value there and no
 * two rows share it (a field looks one row up by it). Row numbers in the errors are the spreadsheet's (header = 1).
 */
export function buildDatasetSheet(cells: readonly (readonly ReadCell[])[], requestedKey: string | undefined): DatasetSheet {
  const headers = readHeaders(cells[0]);
  const keyColumn = requestedKey === undefined ? null : (headers.find((header) => header.toLowerCase() === requestedKey.trim().toLowerCase()) ?? null);
  if (requestedKey !== undefined && keyColumn === null) throw new DatasetFileInvalidError('KEY_COLUMN_UNKNOWN', requestedKey);
  const rows: DatasetSheetRow[] = [];
  const keys = new Set<string>();
  for (let index = 1; index < cells.length; index += 1) {
    const sheetRow = index + 1;
    const data: Record<string, string> = {};
    headers.forEach((header, column) => {
      const text = cellText(cells[index]![column] ?? null);
      if (text.length > DATASET_MAX_CELL_CHARACTERS) throw new DatasetFileInvalidError('CELL_TOO_LONG', sheetRow);
      if (text !== '') data[header] = text;
    });
    if (Object.keys(data).length === 0) continue;
    if (rows.length === DATASET_MAX_ROWS) throw new DatasetFileInvalidError('TOO_MANY_ROWS', DATASET_MAX_ROWS);
    const lookupKey = keyColumn === null ? null : (data[keyColumn] ?? null);
    if (keyColumn !== null) {
      if (lookupKey === null) throw new DatasetFileInvalidError('KEY_VALUE_MISSING', sheetRow);
      if (keys.has(lookupKey)) throw new DatasetFileInvalidError('KEY_VALUE_REPEATED', sheetRow);
      keys.add(lookupKey);
    }
    rows.push({ data, lookupKey });
  }
  if (rows.length === 0) throw new DatasetFileInvalidError('NO_ROWS');
  return { columns: headers.map((name) => ({ name, isKey: name === keyColumn })), keyColumn, rows };
}
