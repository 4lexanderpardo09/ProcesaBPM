export type SheetCell = string | number | Date | null;

export interface Sheet {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: ReadonlyArray<readonly SheetCell[]>;
}

/** Port: builds an `.xlsx` workbook, one sheet per entry. Text is written as text, never as a formula. */
export abstract class SpreadsheetWriter {
  abstract write(sheets: readonly Sheet[]): Promise<Buffer>;
}
