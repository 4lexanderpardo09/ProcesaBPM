import { Module } from '@nestjs/common';
import { RandomDispatchJob } from './application/random-dispatch.job.js';
import { RandomDispatchScheduler } from './application/random-dispatch.scheduler.js';
import { EngineModule } from './engine.module.js';

/** The worker's side of the engine: hands out tickets waiting in RANDOM_DISPATCH steps. Imported by the worker only. */
@Module({ imports: [EngineModule], providers: [RandomDispatchJob, RandomDispatchScheduler], exports: [RandomDispatchJob] })
export class DispatchModule {}
