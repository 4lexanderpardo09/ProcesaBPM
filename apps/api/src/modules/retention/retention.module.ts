import { Module } from '@nestjs/common';
import { RetentionJob } from './application/retention.job.js';
import { RetentionScheduler } from './application/retention.scheduler.js';
import { RetentionRepository } from './data/retention.repository.js';

/** Nightly deletion of what is past its retention window (docs/base-de-datos.md §8.27). Imported by the worker only. */
@Module({ providers: [RetentionRepository, RetentionJob, RetentionScheduler], exports: [RetentionJob] })
export class RetentionModule {}
