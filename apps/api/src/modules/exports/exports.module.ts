import { Module } from '@nestjs/common';
import { SpreadsheetModule } from '../../infrastructure/spreadsheet/spreadsheet.module.js';
import { SystemFilesModule } from '../files/system-files.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { ExportCutoffService } from './application/export-cutoff.service.js';
import { ExportLineService } from './application/export-line.service.js';
import { ExportsService } from './application/exports.service.js';
import { EXPORT_REPOSITORIES } from './exports-data.js';
import { ExportCatalogsController, ExportCutoffsController, ExportsController } from './http/exports.controller.js';

/** Scheduled exports ("planos"), the API side: definitions, catalogs, files and "generate now". */
@Module({
  imports: [WorkflowsModule, SystemFilesModule, SpreadsheetModule],
  controllers: [ExportsController, ExportCutoffsController, ExportCatalogsController],
  providers: [...EXPORT_REPOSITORIES, ExportLineService, ExportCutoffService, ExportsService],
})
export class ExportsModule {}
