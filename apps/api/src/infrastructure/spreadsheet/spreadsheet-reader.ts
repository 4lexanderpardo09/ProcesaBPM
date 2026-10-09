export type ReadCell = string | number | boolean | Date | null;

/** Why a workbook could not be read: not a valid `.xlsx`, or larger than allowed once unzipped. */
export class SpreadsheetReadError extends Error {
  constructor(readonly reason: 'UNREADABLE' | 'TOO_LARGE_UNZIPPED', options?: { cause?: unknown }) {
    super(`The workbook could not be read: ${reason}`, options);
  }
}

/** Port: the rows of the first sheet of an `.xlsx` workbook, as the cells hold them (dates as `Date`). */
export abstract class SpreadsheetReader {
  /** Throws `SpreadsheetReadError`. `maxUnzippedBytes` bounds the memory a small, highly compressed file can take. */
  abstract readFirstSheet(content: Uint8Array, limits: { readonly maxUnzippedBytes: number }): Promise<ReadCell[][]>;
}
