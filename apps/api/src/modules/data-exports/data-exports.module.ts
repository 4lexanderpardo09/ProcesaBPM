import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DataExportDownloadsService } from './application/data-export-downloads.service.js';
import { DataExportRequestsService } from './application/data-export-requests.service.js';
import { DataExportRepository } from './data/data-export.repository.js';
import { DataExportsController } from './http/data-exports.controller.js';

/** The API side of the organization data export: requests, their status and the download links. The worker builds the archive. */
@Module({
  imports: [AuthModule],
  controllers: [DataExportsController],
  providers: [DataExportRepository, DataExportRequestsService, DataExportDownloadsService],
})
export class DataExportsModule {}
