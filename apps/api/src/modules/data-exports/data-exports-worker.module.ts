import { Module } from '@nestjs/common';
import { YazlZipArchiveFactory, ZipArchiveFactory } from '../../infrastructure/archive/zip-archive.js';
import { MailModule } from '../../infrastructure/mail/mail.module.js';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { DataExportReadyEmailHandler } from './application/data-export-ready-email.handler.js';
import { DataExportJob } from './application/data-export.job.js';
import { DataExportScheduler } from './application/data-export.scheduler.js';
import { ExportArchiveBuilder } from './application/export-archive-builder.js';
import { DataExportClaimsRepository } from './data/data-export-claims.repository.js';
import { DataExportNoticeRepository } from './data/data-export-notice.repository.js';
import { ExportDataRepository } from './data/export-data.repository.js';

/** The worker's side of the organization data export: builds the archives and mails that they are ready. Worker only. */
@Module({
  imports: [MailModule, OutboxDispatcherModule],
  providers: [
    { provide: ZipArchiveFactory, useClass: YazlZipArchiveFactory },
    ExportDataRepository,
    DataExportClaimsRepository,
    DataExportNoticeRepository,
    ExportArchiveBuilder,
    DataExportJob,
    DataExportScheduler,
    DataExportReadyEmailHandler,
  ],
  exports: [DataExportJob],
})
export class DataExportsWorkerModule {}
