import { Module } from '@nestjs/common';
import { PurgeReminderScheduler } from './application/purge-reminder.scheduler.js';
import { TenantPurgeJob } from './application/tenant-purge.job.js';
import { TenantPurgeScheduler } from './application/tenant-purge.scheduler.js';
import { PurgeReminderRepository } from './data/purge-reminder.repository.js';
import { TenantPurgeRepository } from './data/tenant-purge.repository.js';

/** The worker's side of deleting a tenant: reminds the owner before the purge, then empties its storage and its data. Imported by the worker only. */
@Module({ providers: [TenantPurgeRepository, TenantPurgeJob, TenantPurgeScheduler, PurgeReminderRepository, PurgeReminderScheduler], exports: [TenantPurgeJob, PurgeReminderScheduler] })
export class TenantPurgeModule {}
