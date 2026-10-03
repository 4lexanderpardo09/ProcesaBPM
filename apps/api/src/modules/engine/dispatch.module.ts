import { Module } from '@nestjs/common';
import { DispatchStepService } from './application/dispatch-step.service.js';
import { RandomDispatchJob } from './application/random-dispatch.job.js';
import { RandomDispatchScheduler } from './application/random-dispatch.scheduler.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { EngineModule } from './engine.module.js';

/** The worker's side of the engine: hands out tickets waiting in RANDOM_DISPATCH steps. Imported by the worker only. */
@Module({ imports: [EngineModule, WorkflowsModule], providers: [DispatchStepService, RandomDispatchJob, RandomDispatchScheduler], exports: [RandomDispatchJob] })
export class DispatchModule {}
