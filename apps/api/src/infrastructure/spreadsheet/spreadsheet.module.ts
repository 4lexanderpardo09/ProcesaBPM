import { Module } from '@nestjs/common';
import { ReadExcelFileReader } from './read-excel-file.reader.js';
import { SpreadsheetReader } from './spreadsheet-reader.js';
import { SpreadsheetWriter } from './spreadsheet-writer.js';
import { WriteExcelFileWriter } from './write-excel-file.writer.js';

@Module({
  providers: [
    { provide: SpreadsheetWriter, useClass: WriteExcelFileWriter },
    { provide: SpreadsheetReader, useClass: ReadExcelFileReader },
  ],
  exports: [SpreadsheetWriter, SpreadsheetReader],
})
export class SpreadsheetModule {}
