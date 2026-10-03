import { Module } from '@nestjs/common';
import { TenantPurgeJob } from './application/tenant-purge.job.js';
import { TenantPurgeScheduler } from './application/tenant-purge.scheduler.js';
import { TenantPurgeRepository } from './data/tenant-purge.repository.js';

/** The worker's side of deleting a tenant: empties its storage and then its data. Imported by the worker only. */
@Module({ providers: [TenantPurgeRepository, TenantPurgeJob, TenantPurgeScheduler], exports: [TenantPurgeJob] })
export class TenantPurgeModule {}
