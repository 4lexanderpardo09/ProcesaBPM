import { Module } from '@nestjs/common';
import { OutboxDispatcherModule } from '../../infrastructure/outbox/outbox-dispatcher.module.js';
import { WaitElapsedHandler } from './application/wait-elapsed.handler.js';
import { WaitResumeJob } from './application/wait-resume.job.js';
import { WaitResumeScheduler } from './application/wait-resume.scheduler.js';
import { EngineModule } from './engine.module.js';

/** The worker's side of WAIT blocks: wakes the parked tickets whose time has come. Imported by the worker only. */
@Module({ imports: [EngineModule, OutboxDispatcherModule], providers: [WaitElapsedHandler, WaitResumeJob, WaitResumeScheduler], exports: [WaitResumeJob] })
export class WaitModule {}
