import { Module } from '@nestjs/common';
import { SlaOverdueJob } from './application/sla-overdue.job.js';
import { SlaOverdueScheduler } from './application/sla-overdue.scheduler.js';
import { SlaWarningJob } from './application/sla-warning.job.js';

/** SLA background work: warnings at 80 % of the time and alerts for clocks that went past their due date. Imported by the worker. */
@Module({ providers: [SlaOverdueJob, SlaWarningJob, SlaOverdueScheduler], exports: [SlaOverdueJob, SlaWarningJob] })
export class SlaModule {}
