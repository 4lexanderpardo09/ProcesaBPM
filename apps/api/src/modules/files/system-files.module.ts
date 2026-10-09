import { Module } from '@nestjs/common';
import { SystemFileService } from './application/system-file.service.js';
import { QuotaWarningService } from './application/quota-warning.service.js';
import { StoredFileRepository } from './data/stored-file.repository.js';
import { TenantUsageRepository } from './data/tenant-usage.repository.js';
import { TicketDocumentRepository } from './data/ticket-document.repository.js';

/** Files the system produces (generated PDFs), without the upload endpoints. Imported by the worker. */
@Module({ providers: [StoredFileRepository, TenantUsageRepository, TicketDocumentRepository, SystemFileService, QuotaWarningService], exports: [SystemFileService] })
export class SystemFilesModule {}
