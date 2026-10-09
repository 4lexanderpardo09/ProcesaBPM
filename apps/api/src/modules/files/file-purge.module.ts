import { Module } from '@nestjs/common';
import { FilePurgeJob } from './application/file-purge.job.js';
import { FilePurgeScheduler } from './application/file-purge.scheduler.js';
import { QuotaWarningService } from './application/quota-warning.service.js';
import { StoredFileRepository } from './data/stored-file.repository.js';
import { TenantUsageRepository } from './data/tenant-usage.repository.js';

/** The worker's side of the files module: removes abandoned uploads. Imported by the worker only. */
@Module({ providers: [StoredFileRepository, TenantUsageRepository, QuotaWarningService, FilePurgeJob, FilePurgeScheduler], exports: [FilePurgeJob] })
export class FilePurgeModule {}
