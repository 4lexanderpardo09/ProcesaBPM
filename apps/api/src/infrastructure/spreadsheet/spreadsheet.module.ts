import { Module } from '@nestjs/common';
import { SpreadsheetWriter } from './spreadsheet-writer.js';
import { WriteExcelFileWriter } from './write-excel-file.writer.js';

@Module({ providers: [{ provide: SpreadsheetWriter, useClass: WriteExcelFileWriter }], exports: [SpreadsheetWriter] })
export class SpreadsheetModule {}
