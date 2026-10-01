import { Module } from '@nestjs/common';
import { SlaOverdueJob } from './application/sla-overdue.job.js';
import { SlaOverdueScheduler } from './application/sla-overdue.scheduler.js';

/** SLA background work: alerts for clocks that went past their due date. Imported by the worker. */
@Module({ providers: [SlaOverdueJob, SlaOverdueScheduler], exports: [SlaOverdueJob] })
export class SlaModule {}
