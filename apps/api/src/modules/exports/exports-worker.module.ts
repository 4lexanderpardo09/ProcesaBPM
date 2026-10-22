import { Module } from '@nestjs/common';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { SpreadsheetModule } from '../../infrastructure/spreadsheet/spreadsheet.module.js';
import { SystemFilesModule } from '../files/system-files.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { ExportCutoffJob } from './application/export-cutoff.job.js';
import { ExportCutoffScheduler } from './application/export-cutoff.scheduler.js';
import { ExportCutoffService } from './application/export-cutoff.service.js';
import { ExportLineHandlers } from './application/export-line.handlers.js';
import { ExportLineService } from './application/export-line.service.js';
import { EXPORT_REPOSITORIES } from './exports-data.js';

/** The worker's side of exports: writes the lines a ticket's events ask for and runs the scheduled cutoffs. Imported by the worker only. */
@Module({
  imports: [OutboxDispatcherModule, WorkflowsModule, SystemFilesModule, SpreadsheetModule],
  providers: [...EXPORT_REPOSITORIES, ExportLineService, ExportCutoffService, ExportLineHandlers, ExportCutoffJob, ExportCutoffScheduler],
  exports: [ExportCutoffJob],
})
export class ExportsWorkerModule {}
