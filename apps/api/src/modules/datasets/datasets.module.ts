import { Module } from '@nestjs/common';
import { SpreadsheetModule } from '../../infrastructure/spreadsheet/spreadsheet.module.js';
import { FilesModule } from '../files/files.module.js';
import { DatasetOptionsService } from './application/dataset-options.service.js';
import { DatasetsService } from './application/datasets.service.js';
import { DatasetRepository } from './data/dataset.repository.js';
import { DatasetFieldsController } from './http/dataset-fields.controller.js';
import { DatasetsController } from './http/datasets.controller.js';

/** Spreadsheets loaded as the source of field values (`datasets`, `dataset_rows`), and the values a form asks for. API only. */
@Module({
  imports: [FilesModule, SpreadsheetModule],
  controllers: [DatasetsController, DatasetFieldsController],
  providers: [DatasetRepository, DatasetsService, DatasetOptionsService],
})
export class DatasetsModule {}
